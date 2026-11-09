-- Model A (approved 2026-11-09): the platform organizes obligations only; members pay each other directly.
-- A payment is "PAID" only when the payer declares it AND the cycle recipient confirms receipt (two-party check).
BEGIN;

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  code_hash char(64) NOT NULL,          -- sha256(code + pepper), never the code itself
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_challenges (phone_e164, created_at DESC);

CREATE TABLE gamiya_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  code text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  max_uses int NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (uses <= max_uses)
);

ALTER TABLE gamiya_members ADD COLUMN role text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MANAGER','MEMBER'));

-- Lottery approvals by members other than the executor (maker–checker), stored before execution.
CREATE TABLE lottery_approvals (
  session_id uuid NOT NULL REFERENCES lottery_sessions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
ALTER TABLE lottery_sessions ADD COLUMN seed_ciphertext text;   -- seed kept encrypted until reveal
ALTER TABLE lottery_sessions ADD COLUMN prepared_by uuid REFERENCES users(id);

-- Peer-to-peer settlement evidence (no funds touch the platform).
CREATE TABLE installment_settlements (
  installment_id uuid PRIMARY KEY REFERENCES gamiya_installments(id),
  payer_declared_at timestamptz NOT NULL,
  payer_reference text,                  -- bank transfer ref chosen by the payer; no account numbers
  recipient_confirmed_at timestamptz,
  recipient_confirmed_by uuid REFERENCES users(id),
  disputed boolean NOT NULL DEFAULT false
);

CREATE OR REPLACE FUNCTION forbid_confirmed_settlement_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.recipient_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'confirmed settlement % is immutable', OLD.installment_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'settlements cannot be deleted'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON installment_settlements
  FOR EACH ROW EXECUTE FUNCTION forbid_confirmed_settlement_change();

COMMIT;
