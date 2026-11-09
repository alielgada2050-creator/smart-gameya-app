import { createHash } from 'node:crypto';
import type { Minor } from './money.ts';

/**
 * Append-only double-entry ledger (MASTER PROMPT §6.1). Entries are never edited or deleted;
 * corrections are reversing transactions. Each transaction is hash-chained to the previous one so
 * tampering with history is detectable. In production this mirrors ledger_transactions / ledger_entries
 * with DB-level triggers that reject UPDATE/DELETE.
 */
export interface Entry { account: string; debit: Minor; credit: Minor }
export interface Transaction {
  id: string;
  idempotencyKey: string;
  currency: string;
  memo: string;
  entries: Entry[];
  reversesId?: string;
  prevHash: string;
  hash: string;
}

export class LedgerError extends Error {}

/** Canonical, field-ordered hash of a transaction (independent of object key order). */
function hashOf(t: Omit<Transaction, 'hash'>): string {
  const canonical = [t.id, t.idempotencyKey, t.currency, t.memo, t.reversesId ?? '', t.prevHash,
    t.entries.map((e) => [e.account, e.debit.toString(), e.credit.toString()])];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export class Ledger {
  readonly #txs: Transaction[] = [];
  readonly #byKey = new Map<string, Transaction>();

  post(input: { idempotencyKey: string; currency: string; memo: string; entries: Entry[]; reversesId?: string }): Transaction {
    const existing = this.#byKey.get(input.idempotencyKey);
    if (existing) return existing; // idempotent: replaying the same request never double-posts
    if (input.entries.length < 2) throw new LedgerError('a transaction needs at least two entries');
    let dr = 0n, cr = 0n;
    for (const e of input.entries) {
      if (e.debit < 0n || e.credit < 0n) throw new LedgerError('amounts must be non-negative');
      if ((e.debit === 0n) === (e.credit === 0n)) throw new LedgerError('each entry is either a debit or a credit');
      dr += e.debit; cr += e.credit;
    }
    if (dr !== cr) throw new LedgerError(`unbalanced transaction: debits ${dr} != credits ${cr}`);
    const prevHash = this.#txs.at(-1)?.hash ?? '0'.repeat(64);
    const id = `tx_${this.#txs.length + 1}`;
    const draft = { id, ...input, entries: input.entries.map((e) => Object.freeze({ ...e })), prevHash };
    const tx: Transaction = Object.freeze({ ...draft, hash: hashOf(draft) }) as Transaction;
    this.#txs.push(tx);
    this.#byKey.set(input.idempotencyKey, tx);
    return tx;
  }

  reverse(txId: string, idempotencyKey: string, memo: string): Transaction {
    const orig = this.#txs.find((t) => t.id === txId);
    if (!orig) throw new LedgerError(`unknown transaction ${txId}`);
    if (this.#txs.some((t) => t.reversesId === txId)) throw new LedgerError(`${txId} already reversed`);
    return this.post({
      idempotencyKey, currency: orig.currency, memo, reversesId: txId,
      entries: orig.entries.map((e) => ({ account: e.account, debit: e.credit, credit: e.debit })),
    });
  }

  balance(account: string, currency: string): Minor {
    let b = 0n;
    for (const t of this.#txs) if (t.currency === currency) for (const e of t.entries) if (e.account === account) b += e.debit - e.credit;
    return b;
  }

  /** Global invariant: total debits == total credits per currency, and the hash chain is intact. */
  verify(): boolean {
    let prev = '0'.repeat(64);
    const sums = new Map<string, Minor>();
    for (const t of this.#txs) {
      if (t.prevHash !== prev) return false;
      if (hashOf(t) !== t.hash) return false;
      for (const e of t.entries) sums.set(t.currency, (sums.get(t.currency) ?? 0n) + e.debit - e.credit);
      prev = t.hash;
    }
    return [...sums.values()].every((v) => v === 0n);
  }

  get transactions(): readonly Transaction[] { return this.#txs; }
}
