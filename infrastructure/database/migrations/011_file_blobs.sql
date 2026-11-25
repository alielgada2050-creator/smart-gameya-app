-- 0.16: receipts and promissory notes can live inside Postgres instead of on the server's disk.
-- Used on hosts whose disk is wiped on every restart or deploy (e.g. Render's free plan). Files are ≤ 5 MB and
-- photos are reduced in the browser first, so a small database holds thousands of receipts.
CREATE TABLE file_blobs (
  storage_key text PRIMARY KEY,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
