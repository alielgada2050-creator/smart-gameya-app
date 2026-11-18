-- 0.14: replace one member with another («تبديل عضو بعضو»). The new person takes the outgoing member's seat:
-- their turn and every installment not yet paid. What the outgoing member already paid stays on their record;
-- any compensation between the two is private to them (model A: the platform holds no money).
-- Needs: the outgoing member's consent, the organizer's approval, and the incoming person's signed pledge.
CREATE TABLE seat_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gamiya_id uuid NOT NULL REFERENCES gamiyas(id),
  from_member_id uuid NOT NULL REFERENCES gamiya_members(id),
  code text NOT NULL UNIQUE,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  created_by uuid NOT NULL REFERENCES users(id),
  outgoing_consent_at timestamptz,
  organizer_approved_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  to_user_id uuid REFERENCES users(id),
  to_member_id uuid REFERENCES gamiya_members(id),
  moved_installments int,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  closed_at timestamptz
);
-- one open replacement per seat at a time
CREATE UNIQUE INDEX seat_transfers_one_open ON seat_transfers (from_member_id) WHERE status = 'OPEN';
