# SECURITY

- Report vulnerabilities privately to the project owner.
- No secrets in code; use .env (see .env.example).
- Financial tables, lottery results, consents and audit logs are append-only at the DB level.
- Identity documents: private encrypted bucket, signed URLs, access logged, never used for model training.
