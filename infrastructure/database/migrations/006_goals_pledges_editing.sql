-- 006: circle types, editable terms with member re-confirmation, the signed pledge, and personal goals.
BEGIN;

-- Circle type (family, school, Hajj…): drives templates and the goal it serves.
ALTER TABLE gamiyas ADD COLUMN category text NOT NULL DEFAULT 'OTHER'
  CHECK (category IN ('FAMILY','FRIENDS','WORK','SCHOOL','HAJJ','WEDDING','RAMADAN','FRIDAY','TRAVEL','HOME','CAR','OTHER'));
-- Bumped whenever money terms change; every member's pledge must match the current version.
ALTER TABLE gamiyas ADD COLUMN terms_version int NOT NULL DEFAULT 1;

-- The pledge (إقرار وتعهد) each member signs before joining, and again after the organizer changes the terms.
-- Evidence pack: exact text hash, the terms in numbers, typed name as electronic signature, time, IP and device.
CREATE TABLE pledges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  terms_version int NOT NULL,
  pledge_version text NOT NULL,
  text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  typed_name text NOT NULL CHECK (char_length(typed_name) BETWEEN 2 AND 100),
  terms jsonb NOT NULL,
  ip_address inet,
  user_agent text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gamiya_id, terms_version)
);
CREATE TRIGGER pledges_append_only BEFORE UPDATE OR DELETE ON pledges FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Personal goals (Hajj, school fees, wedding…), optionally served by one of the user's circles.
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('FAMILY','FRIENDS','WORK','SCHOOL','HAJJ','WEDDING','RAMADAN','FRIDAY','TRAVEL','HOME','CAR','OTHER')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  target_amount numeric(18,2) NOT NULL CHECK (target_amount > 0),
  currency char(3) NOT NULL,
  target_date date,
  gamiya_id uuid REFERENCES gamiyas(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DONE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON goals (user_id, status);

COMMIT;
