-- 007: direct invitations. The organizer invites people by phone number (or picks people they already share a circle
-- with); a registered person gets the invitation in the app at once, an unregistered number gets it when they sign up
-- with that number. Accepting still goes through the invitation code, the agreement and the signed pledge.
BEGIN;
CREATE TABLE direct_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  invitation_id uuid NOT NULL REFERENCES gamiya_invitations(id),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  invited_user_id uuid REFERENCES users(id),
  invited_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','DECLINED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (gamiya_id, phone_e164)
);
CREATE INDEX ON direct_invitations (phone_e164, status);
COMMIT;
