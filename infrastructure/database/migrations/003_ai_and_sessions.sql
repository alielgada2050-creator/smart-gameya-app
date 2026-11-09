-- Refresh-token rotation with reuse detection, and AI usage telemetry without prompt content.
BEGIN;

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  family_id uuid NOT NULL,                 -- all rotations of one login share a family
  token_hash char(64) NOT NULL UNIQUE,     -- sha256 of the opaque token; the token itself is never stored
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id)
);
CREATE INDEX ON refresh_tokens (family_id);
CREATE INDEX ON refresh_tokens (user_id);

-- One row per provider attempt. Prompts, answers and user financial inputs are NOT stored (PDPL data minimisation).
CREATE TABLE ai_model_usage (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  feature text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  outcome text NOT NULL,                   -- OK, RATE_LIMITED, UNAVAILABLE, TIMEOUT, AUTH, BAD_RESPONSE
  guard_passed boolean,                    -- numeric hallucination guard result for OK answers
  latency_ms int NOT NULL,
  input_tokens int,
  output_tokens int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_model_usage (provider, created_at);

COMMIT;
