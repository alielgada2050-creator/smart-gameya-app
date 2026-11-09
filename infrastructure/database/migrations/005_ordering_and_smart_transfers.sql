-- 005: payout order by lottery, members' agreement, or priority (every member must approve);
--      smart transfers: declared amount/date, automatic matching, one receipt per transfer.
BEGIN;

-- Each member's declared priority. The free-text note is visible to the organizer only and is never sent to a language model.
CREATE TABLE priority_requests (
  member_id uuid PRIMARY KEY REFERENCES gamiya_members(id),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  preference text NOT NULL CHECK (preference IN ('EARLY','LATE','NONE')),
  reason text NOT NULL DEFAULT 'NONE' CHECK (reason IN ('NONE','WEDDING','EDUCATION','HEALTH','HOUSING','BUSINESS','DEBT','TRAVEL','OTHER')),
  share_reason boolean NOT NULL DEFAULT false,   -- show the reason category to other members
  needed_by date,
  note text CHECK (char_length(note) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON priority_requests (gamiya_id);

-- An order proposed by the organizer. It takes effect only when every member approves (owner decision 2026-11-10).
CREATE TABLE order_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  mode text NOT NULL CHECK (mode IN ('AGREED','PRIORITY')),
  member_order uuid[] NOT NULL,
  ai_assisted boolean NOT NULL DEFAULT false,
  algorithm_version text,
  rationale text CHECK (char_length(rationale) <= 1000),
  proposed_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ADOPTED','REJECTED','WITHDRAWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX one_open_proposal_per_gamiya ON order_proposals (gamiya_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX one_adopted_order_per_gamiya ON order_proposals (gamiya_id) WHERE status = 'ADOPTED';

-- Votes are final and append-only: the record of each member's consent to the payout order.
CREATE TABLE order_votes (
  proposal_id uuid NOT NULL REFERENCES order_proposals(id),
  member_id uuid NOT NULL REFERENCES gamiya_members(id),
  vote text NOT NULL CHECK (vote IN ('APPROVE','OBJECT')),
  reason text CHECK (char_length(reason) <= 500),
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, member_id),
  CHECK (vote = 'APPROVE' OR char_length(coalesce(reason, '')) >= 3)
);
CREATE TRIGGER order_votes_append_only BEFORE UPDATE OR DELETE ON order_votes FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Smart transfers: what the payer declares, and the automatic check against what was due.
ALTER TABLE installment_settlements ADD COLUMN declared_amount numeric(18,2) CHECK (declared_amount > 0);
ALTER TABLE installment_settlements ADD COLUMN transfer_date date;
ALTER TABLE installment_settlements ADD COLUMN match_result jsonb;

COMMIT;
