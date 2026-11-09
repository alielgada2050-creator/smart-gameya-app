-- Smart Gam'eya — core schema (Phase 1 draft, PostgreSQL 16)
-- Rules applied: UUID PKs, FKs, NUMERIC money, UTC timestamptz, append-only financial & audit tables,
-- balanced double-entry enforced in the database, idempotency keys, tenant isolation column.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE frequency AS ENUM ('WEEKLY','BIWEEKLY','MONTHLY');
CREATE TYPE gamiya_status AS ENUM ('DRAFT','RECRUITING','LOCKED','ACTIVE','COMPLETED','CANCELLED');
CREATE TYPE ordering_method AS ENUM ('LOTTERY','PREFERENCE','CONSENSUS','MIXED','FIXED');
CREATE TYPE member_status AS ENUM ('INVITED','PENDING_APPROVAL','ACTIVE','DEFAULTED','WITHDRAWN','COMPLETED');
CREATE TYPE installment_status AS ENUM ('SCHEDULED','DUE','PAID','LATE','IN_GRACE','DEFAULTED','WAIVED');
CREATE TYPE payment_status AS ENUM ('PENDING','INITIATED','PROCESSING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED','DISPUTED','RECONCILED');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  phone_e164 text NOT NULL UNIQUE,
  email text UNIQUE,
  full_name text NOT NULL,
  locale text NOT NULL DEFAULT 'ar-SA',
  kyc_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (kyc_status IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Identity documents: only object-store keys are stored; files live in a private, encrypted bucket.
CREATE TABLE user_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  doc_type text NOT NULL CHECK (doc_type IN ('NATIONAL_ID','IQAMA','PASSPORT','PROOF_OF_ADDRESS','PROOF_OF_INCOME','OTHER')),
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  number_last4 text,               -- never store/display the full ID number in app tables
  retention_until date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gamiyas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  creator_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'SAR',
  frequency frequency NOT NULL,
  contribution numeric(18,2) NOT NULL CHECK (contribution > 0),
  member_count int NOT NULL CHECK (member_count BETWEEN 2 AND 60),
  cycle_count int NOT NULL,
  start_date date NOT NULL,
  grace_days int NOT NULL DEFAULT 3 CHECK (grace_days >= 0),
  ordering ordering_method NOT NULL,
  fee_policy_version text,
  status gamiya_status NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cycles_equal_members CHECK (cycle_count = member_count)
);

CREATE TABLE gamiya_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  user_id uuid NOT NULL REFERENCES users(id),
  payout_position int,
  status member_status NOT NULL DEFAULT 'INVITED',
  joined_at timestamptz,
  UNIQUE (gamiya_id, user_id),
  UNIQUE (gamiya_id, payout_position)
);
CREATE INDEX ON gamiya_members (user_id);

CREATE TABLE gamiya_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  cycle_index int NOT NULL CHECK (cycle_index >= 1),
  due_date date NOT NULL,
  pot_amount numeric(18,2) NOT NULL,
  recipient_member_id uuid REFERENCES gamiya_members(id),
  UNIQUE (gamiya_id, cycle_index)
);

CREATE TABLE gamiya_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES gamiya_cycles(id),
  member_id uuid NOT NULL REFERENCES gamiya_members(id),
  amount_due numeric(18,2) NOT NULL CHECK (amount_due >= 0),
  fee_component numeric(18,2) NOT NULL DEFAULT 0,
  status installment_status NOT NULL DEFAULT 'SCHEDULED',
  UNIQUE (cycle_id, member_id)
);
CREATE INDEX ON gamiya_installments (member_id, status);

-- Lottery: commitment published before draw; seed revealed after; immutable once executed.
CREATE TABLE lottery_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  algorithm_version text NOT NULL,
  commitment_sha256 char(64) NOT NULL,
  candidates jsonb NOT NULL,
  is_trial boolean NOT NULL DEFAULT false,
  prepared_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_official_draw_per_gamiya ON lottery_sessions (gamiya_id) WHERE NOT is_trial;

CREATE TABLE lottery_results (
  session_id uuid PRIMARY KEY REFERENCES lottery_sessions(id),
  revealed_seed_hex char(64) NOT NULL,
  public_entropy text NOT NULL,
  result_order jsonb NOT NULL,
  executed_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid NOT NULL REFERENCES users(id),
  executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maker_checker CHECK (executed_by <> approved_by),
  CONSTRAINT seed_hex_format CHECK (revealed_seed_hex ~ '^[0-9a-f]{64}$')
);

-- Double-entry ledger
CREATE TABLE financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,      -- e.g. psp_clearing, member:<uuid>:receivable, gamiya:<uuid>:pot
  currency char(3) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY'))
);

CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  currency char(3) NOT NULL,
  memo text NOT NULL,
  reverses_id uuid UNIQUE REFERENCES ledger_transactions(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id uuid NOT NULL REFERENCES financial_accounts(id),
  debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CONSTRAINT one_side CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX ON ledger_entries (account_id);
CREATE INDEX ON ledger_entries (transaction_id);

CREATE FUNCTION assert_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n int;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d, c, n
  FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'unbalanced ledger transaction % (debit %, credit %, entries %)', NEW.transaction_id, d, c, n;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_balanced();

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only: % rejected (use a reversing entry)', TG_TABLE_NAME, TG_OP; END $$;
CREATE TRIGGER ledger_tx_append_only BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER lottery_results_append_only BEFORE UPDATE OR DELETE ON lottery_results FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION check_lottery_seed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE commit_hex text;
BEGIN
  SELECT commitment_sha256 INTO commit_hex FROM lottery_sessions WHERE id = NEW.session_id;
  IF encode(digest(decode(NEW.revealed_seed_hex,'hex'),'sha256'),'hex') <> commit_hex THEN
    RAISE EXCEPTION 'revealed seed does not match commitment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lottery_seed_check BEFORE INSERT ON lottery_results FOR EACH ROW EXECUTE FUNCTION check_lottery_seed();

-- Payments: never trust the client; state changes only from verified PSP webhooks.
CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES gamiya_installments(id),
  provider text NOT NULL,
  provider_ref text,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  status payment_status NOT NULL DEFAULT 'PENDING',
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);

CREATE TABLE payment_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  signature_valid boolean NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)  -- replay protection
);

-- Agreements & consent evidence
CREATE TABLE agreement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code text NOT NULL,
  version text NOT NULL,
  locale text NOT NULL,
  body_sha256 char(64) NOT NULL,
  storage_key text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_code, version, locale)
);

CREATE TABLE agreement_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_version_id uuid NOT NULL REFERENCES agreement_versions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  gamiya_id uuid REFERENCES gamiyas(id),
  verification_method text NOT NULL,   -- e.g. OTP_SMS, NAFATH (subject to legal review)
  ip_address inet,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_version_id, user_id, gamiya_id)
);
CREATE TRIGGER acceptances_append_only BEFORE UPDATE OR DELETE ON agreement_acceptances FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  correlation_id text,
  details jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
