-- 0.13: an account can be a Google account without a mobile number (used when no SMS provider is configured).
-- Every account still has a verified identity: a mobile number verified by code, or a Google account with a verified email.
ALTER TABLE users ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_has_identity CHECK (phone_e164 IS NOT NULL OR google_sub IS NOT NULL);

-- A Google-only person has no number: the organizer invites them as an account (someone they already share a circle with).
ALTER TABLE direct_invitations ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE direct_invitations ADD CONSTRAINT direct_invitations_target CHECK (phone_e164 IS NOT NULL OR invited_user_id IS NOT NULL);
CREATE UNIQUE INDEX direct_invitations_by_account ON direct_invitations (gamiya_id, invited_user_id) WHERE phone_e164 IS NULL;
