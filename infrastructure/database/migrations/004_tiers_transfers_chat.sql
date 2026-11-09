-- Tiers, Google sign-in, payout methods, receipts, three-party approval, promissory notes,
-- circle chat (append-only), disputes, reminders and in-app notifications.
BEGIN;

-- Identity
ALTER TABLE users ADD COLUMN google_sub text UNIQUE;
ALTER TABLE users ADD COLUMN platform_role text NOT NULL DEFAULT 'NONE' CHECK (platform_role IN ('NONE','COMPLIANCE_OFFICER','PLATFORM_ADMIN'));

-- Circles: country, tier and platform approval
ALTER TABLE gamiyas ADD COLUMN country char(2) NOT NULL DEFAULT 'SA';
ALTER TABLE gamiyas ADD COLUMN tier text NOT NULL DEFAULT 'SMALL' CHECK (tier IN ('SMALL','MEDIUM','LARGE'));
ALTER TABLE gamiyas ADD COLUMN platform_approval text NOT NULL DEFAULT 'NOT_REQUIRED'
  CHECK (platform_approval IN ('NOT_REQUIRED','AWAITING_NOTES','PENDING','APPROVED','REJECTED'));
ALTER TABLE gamiyas ADD COLUMN platform_reviewed_by uuid REFERENCES users(id);
ALTER TABLE gamiyas ADD COLUMN platform_reviewed_at timestamptz;
ALTER TABLE gamiyas ADD COLUMN platform_review_note text;
ALTER TABLE gamiyas ADD CONSTRAINT large_needs_approval CHECK (tier <> 'LARGE' OR platform_approval <> 'NOT_REQUIRED');

-- Uploaded files (receipts, promissory notes). Bytes live in private storage; only metadata here.
CREATE TABLE uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  purpose text NOT NULL CHECK (purpose IN ('RECEIPT','PROMISSORY_NOTE')),
  mime text NOT NULL CHECK (mime IN ('application/pdf','image/png','image/jpeg','image/webp')),
  size_bytes int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256 char(64) NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON uploaded_files (gamiya_id);

-- Where a member receives payouts. The value is encrypted (AES-256-GCM); only the masked tail is queryable.
CREATE TABLE payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  country char(2) NOT NULL,
  kind text NOT NULL,
  value_ciphertext text NOT NULL,
  value_last4 text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ON payout_methods (user_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX one_default_method_per_country ON payout_methods (user_id, country) WHERE is_default AND deleted_at IS NULL;

-- Three-party settlement: payer declares (+ receipt) → organizer approves (unless a party) → recipient confirms.
ALTER TABLE installment_settlements ADD COLUMN method_kind text;
ALTER TABLE installment_settlements ADD COLUMN receipt_file_id uuid REFERENCES uploaded_files(id);
ALTER TABLE installment_settlements ADD COLUMN organizer_approved_at timestamptz;
ALTER TABLE installment_settlements ADD COLUMN organizer_approved_by uuid REFERENCES users(id);
ALTER TABLE installment_settlements ADD COLUMN attempts int NOT NULL DEFAULT 1;
ALTER TABLE installment_settlements ADD COLUMN voided_at timestamptz; -- set when a declaration is rejected; the payer must declare again (history stays in settlement_events)

-- Every settlement step, append-only: the transaction record members and disputes rely on.
CREATE TABLE settlement_events (
  id bigserial PRIMARY KEY,
  installment_id uuid NOT NULL REFERENCES gamiya_installments(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  event text NOT NULL CHECK (event IN ('DECLARED','REDECLARED','ORGANIZER_APPROVED','ORGANIZER_REJECTED','RECIPIENT_CONFIRMED','DISPUTED','DISPUTE_RESOLVED')),
  receipt_file_id uuid REFERENCES uploaded_files(id),
  note text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON settlement_events (installment_id);
CREATE TRIGGER settlement_events_append_only BEFORE UPDATE OR DELETE ON settlement_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Promissory notes (سند لأمر) for LARGE circles: one per non-organizer member, payable to the organizer.
CREATE TABLE promissory_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  member_id uuid NOT NULL REFERENCES gamiya_members(id),
  beneficiary_user_id uuid NOT NULL REFERENCES users(id),
  file_id uuid NOT NULL REFERENCES uploaded_files(id),
  reference text NOT NULL,             -- issuing platform reference, e.g. Nafith note number
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','ACCEPTED','REJECTED')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  UNIQUE (gamiya_id, member_id)
);

-- Circle chat: member messages, system records of every transaction step, and assistant replies. Append-only.
CREATE TABLE chat_messages (
  id bigserial PRIMARY KEY,
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  kind text NOT NULL CHECK (kind IN ('USER','SYSTEM','ASSISTANT')),
  sender_user_id uuid REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  ref_entity text,
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'USER') = (sender_user_id IS NOT NULL))
);
CREATE INDEX ON chat_messages (gamiya_id, id);
CREATE TRIGGER chat_append_only BEFORE UPDATE OR DELETE ON chat_messages FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  installment_id uuid NOT NULL REFERENCES gamiya_installments(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  outcome text CHECK (outcome IN ('PAYER_TO_RESEND','RECEIPT_VALID')),
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX one_open_dispute_per_installment ON disputes (installment_id) WHERE status = 'OPEN';

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  gamiya_id uuid REFERENCES gamiyas(id),
  kind text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX ON notifications (user_id, read_at);

-- Reminder idempotency: one reminder of each kind per installment per day, whatever runs the job.
CREATE TABLE reminder_log (
  installment_id uuid NOT NULL REFERENCES gamiya_installments(id),
  kind text NOT NULL CHECK (kind IN ('DUE_SOON','DUE_TODAY','LATE')),
  sent_on date NOT NULL,
  PRIMARY KEY (installment_id, kind, sent_on)
);

COMMIT;
