-- Gate C database checks: each block must fail exactly as expected.
\set ON_ERROR_STOP off
\echo '--- setup'
INSERT INTO users (id, phone_e164, full_name) VALUES
 ('00000000-0000-0000-0000-000000000001','+966500000001','Test Admin A'),
 ('00000000-0000-0000-0000-000000000002','+966500000002','Test Admin B');
INSERT INTO financial_accounts (id, code, currency, kind) VALUES
 ('10000000-0000-0000-0000-000000000001','psp_clearing','SAR','ASSET'),
 ('10000000-0000-0000-0000-000000000002','member:test:receivable','SAR','ASSET');

\echo '--- T1 balanced transaction commits (expect OK)'
BEGIN;
INSERT INTO ledger_transactions (id, idempotency_key, currency, memo) VALUES ('20000000-0000-0000-0000-000000000001','k1','SAR','installment');
INSERT INTO ledger_entries (transaction_id, account_id, debit) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1000.00);
INSERT INTO ledger_entries (transaction_id, account_id, credit) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1000.00);
COMMIT;

\echo '--- T2 unbalanced transaction (expect ERROR unbalanced)'
BEGIN;
INSERT INTO ledger_transactions (id, idempotency_key, currency, memo) VALUES ('20000000-0000-0000-0000-000000000002','k2','SAR','bad');
INSERT INTO ledger_entries (transaction_id, account_id, debit) VALUES ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',1000.00);
INSERT INTO ledger_entries (transaction_id, account_id, credit) VALUES ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',999.00);
COMMIT;

\echo '--- T3 duplicate idempotency key (expect ERROR duplicate key)'
INSERT INTO ledger_transactions (idempotency_key, currency, memo) VALUES ('k1','SAR','replay');

\echo '--- T4 edit/delete ledger (expect 2x ERROR append-only)'
UPDATE ledger_entries SET debit = 1 WHERE transaction_id = '20000000-0000-0000-0000-000000000001';
DELETE FROM ledger_transactions;

\echo '--- T5 gamiya with cycles != members (expect ERROR cycles_equal_members)'
INSERT INTO gamiyas (creator_id, name, frequency, contribution, member_count, cycle_count, start_date, ordering)
VALUES ('00000000-0000-0000-0000-000000000001','x','MONTHLY',1000,12,10,'2027-01-01','LOTTERY');

\echo '--- T6 lottery seed must match commitment, maker-checker (expect OK then 2x ERROR)'
INSERT INTO gamiyas (id, creator_id, name, frequency, contribution, member_count, cycle_count, start_date, ordering)
VALUES ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Test circle','MONTHLY',1000,12,12,'2027-01-01','LOTTERY');
INSERT INTO lottery_sessions (id, gamiya_id, algorithm_version, commitment_sha256, candidates)
VALUES ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','sg-lottery/1.0.0-hmac-sha256-fy',
        encode(digest(decode(repeat('ab',32),'hex'),'sha256'),'hex'),'[]');
INSERT INTO lottery_results (session_id, revealed_seed_hex, public_entropy, result_order, executed_by, approved_by)
VALUES ('40000000-0000-0000-0000-000000000001', repeat('cd',32),'e','[]','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
INSERT INTO lottery_results (session_id, revealed_seed_hex, public_entropy, result_order, executed_by, approved_by)
VALUES ('40000000-0000-0000-0000-000000000001', repeat('ab',32),'e','[]','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
INSERT INTO lottery_results (session_id, revealed_seed_hex, public_entropy, result_order, executed_by, approved_by)
VALUES ('40000000-0000-0000-0000-000000000001', repeat('ab',32),'e','[]','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');

\echo '--- T7 second official draw for same gamiya (expect ERROR duplicate key)'
INSERT INTO lottery_sessions (gamiya_id, algorithm_version, commitment_sha256, candidates)
VALUES ('30000000-0000-0000-0000-000000000001','v', repeat('0',64),'[]');

\echo '--- T8 webhook replay (expect OK then ERROR duplicate key)'
INSERT INTO payment_webhooks (provider, provider_event_id, signature_valid, payload) VALUES ('sandbox','evt_1',true,'{}');
INSERT INTO payment_webhooks (provider, provider_event_id, signature_valid, payload) VALUES ('sandbox','evt_1',true,'{}');

\echo '--- final balance check'
SELECT a.code, sum(e.debit - e.credit) AS balance FROM ledger_entries e JOIN financial_accounts a ON a.id = e.account_id GROUP BY a.code ORDER BY a.code;
