-- 005 checks: payout-order consent is final and unambiguous. Each block must fail exactly as expected.
\set ON_ERROR_STOP off
\echo '--- setup'
INSERT INTO users (id, phone_e164, full_name) VALUES
 ('00000000-0000-0000-0000-0000000005a1','+966500000951','Org'), ('00000000-0000-0000-0000-0000000005a2','+966500000952','Mem');
INSERT INTO gamiyas (id, creator_id, name, frequency, contribution, member_count, cycle_count, start_date, ordering, status)
 VALUES ('00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-0000000005a1','T','MONTHLY',100,2,2,'2027-01-01','LOTTERY','LOCKED');
INSERT INTO gamiya_members (id, gamiya_id, user_id, role, status) VALUES
 ('00000000-0000-0000-0000-0000000005c1','00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-0000000005a1','MANAGER','ACTIVE'),
 ('00000000-0000-0000-0000-0000000005c2','00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-0000000005a2','MEMBER','ACTIVE');
INSERT INTO order_proposals (id, gamiya_id, mode, member_order, proposed_by) VALUES
 ('00000000-0000-0000-0000-0000000005d1','00000000-0000-0000-0000-0000000005b1','AGREED',
  ARRAY['00000000-0000-0000-0000-0000000005c2','00000000-0000-0000-0000-0000000005c1']::uuid[],'00000000-0000-0000-0000-0000000005a1');
INSERT INTO order_votes (proposal_id, member_id, vote) VALUES ('00000000-0000-0000-0000-0000000005d1','00000000-0000-0000-0000-0000000005c1','APPROVE');

\echo '--- O1 second open proposal for the same circle (expect ERROR duplicate key one_open_proposal_per_gamiya)'
INSERT INTO order_proposals (gamiya_id, mode, member_order, proposed_by) VALUES
 ('00000000-0000-0000-0000-0000000005b1','PRIORITY', ARRAY[]::uuid[], '00000000-0000-0000-0000-0000000005a1');

\echo '--- O2 objection without a reason (expect ERROR check constraint)'
INSERT INTO order_votes (proposal_id, member_id, vote) VALUES ('00000000-0000-0000-0000-0000000005d1','00000000-0000-0000-0000-0000000005c2','OBJECT');

\echo '--- O3 change or delete a vote (expect 2x ERROR append-only)'
UPDATE order_votes SET vote = 'OBJECT', reason = 'changed my mind';
DELETE FROM order_votes;

\echo '--- O4 voting twice (expect ERROR duplicate key)'
INSERT INTO order_votes (proposal_id, member_id, vote) VALUES ('00000000-0000-0000-0000-0000000005d1','00000000-0000-0000-0000-0000000005c1','APPROVE');

\echo '--- O5 priority with an unknown preference (expect ERROR check constraint)'
INSERT INTO priority_requests (member_id, gamiya_id, preference) VALUES ('00000000-0000-0000-0000-0000000005c2','00000000-0000-0000-0000-0000000005b1','FIRST');
