-- 0.15: sign in with a 6-digit code sent to an email address (any provider: Gmail, Outlook, Hotmail, iCloud…).
-- A code challenge targets a phone or an email; an account's verified email is now a third identity.
ALTER TABLE otp_challenges ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE otp_challenges ADD COLUMN email text;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_target CHECK ((phone_e164 IS NULL) <> (email IS NULL));
CREATE INDEX otp_challenges_email ON otp_challenges (email, created_at DESC) WHERE email IS NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_has_identity;
ALTER TABLE users ADD CONSTRAINT users_has_identity CHECK (phone_e164 IS NOT NULL OR google_sub IS NOT NULL OR email IS NOT NULL);
-- emails are stored lower-case; one account per address regardless of case
CREATE UNIQUE INDEX users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;
