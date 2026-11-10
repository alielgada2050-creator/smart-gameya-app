/**
 * The payment pledge (إقرار وتعهّد بالسداد) as the member signs it: the terms in numbers, each clause confirmed on its own,
 * and the full name typed as the electronic signature. The text and its fingerprint come from the server; the server checks
 * the fingerprint and the name again when the form is sent, so nothing here is trusted for the decision.
 */
import { useEffect, useId, useState } from 'react';
import { date, money, useT } from './i18n.ts';

export interface PledgeView {
  pledgeVersion: string; text: string; textSha256: string; clauses: string[];
  terms: { circleName: string; organizerName: string; memberName: string; currency: string; contribution: string; memberCount: number; frequency: string;
    installments: number; startDate: string; endDate: string; potPerCycle: string; totalCommitment: string; termsVersion: number };
  signedAt?: string | null;
}
export interface PledgeSignature { typedName: string; textSha256: string }

const norm = (s: string) => s.normalize('NFKC').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();

export function PledgeSign({ pledge, onChange, compact = false }: { pledge: PledgeView; onChange: (s: PledgeSignature | null) => void; compact?: boolean }) {
  const { t, lang } = useT();
  const id = useId();
  const [ticks, setTicks] = useState<boolean[]>(() => pledge.clauses.map(() => false));
  const [name, setName] = useState('');
  // a new text (terms changed) resets the confirmations
  useEffect(() => { setTicks(pledge.clauses.map(() => false)); }, [pledge.textSha256]);
  const nameOk = norm(name).length >= 2 && norm(name) === norm(pledge.terms.memberName);
  const complete = ticks.every(Boolean) && nameOk;
  useEffect(() => { onChange(complete ? { typedName: name.trim(), textSha256: pledge.textSha256 } : null); }, [complete, name, pledge.textSha256]);
  const p = pledge.terms;
  const cur = p.currency;

  return (
    <section className="pledge stack-sm" aria-labelledby={`${id}-h`} data-testid="pledge">
      <div className="pledge-head">
        <span className="pledge-seal" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" /><path d="M9 12.5 11 14.5l4-4.5" /></svg>
        </span>
        <div>
          <h3 id={`${id}-h`}>{t.pledge.title}</h3>
          {!compact && <p className="muted small">{t.pledge.intro}</p>}
        </div>
      </div>
      <dl className="kv pledge-terms" aria-label={t.pledge.terms}>
        <dt>{t.contribution}</dt><dd>{money(p.contribution, lang, cur)} {t.perMonth[p.frequency]}</dd>
        <dt>{t.pledge.total}</dt><dd data-testid="pledge-total">{money(p.totalCommitment, lang, cur)} · {t.pledge.installments(p.installments)}</dd>
        <dt>{t.pledge.pot}</dt><dd>{money(p.potPerCycle, lang, cur)}</dd>
        <dt>{t.pledge.period}</dt><dd>{date(p.startDate, lang)} – {date(p.endDate, lang)}</dd>
      </dl>
      <ol className="pledge-clauses">
        {pledge.clauses.map((c, i) => (
          <li key={i}>
            <label className="check"><input type="checkbox" checked={ticks[i] ?? false} onChange={(e) => setTicks(ticks.map((x, j) => (j === i ? e.target.checked : x)))} />
              <span lang="ar" dir="rtl">{c}</span></label>
          </li>
        ))}
      </ol>
      <label>{t.pledge.sign}
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={name.trim().length > 1 && !nameOk}
          aria-describedby={`${id}-hint`} className="signature" maxLength={100} />
      </label>
      <p id={`${id}-hint`} className={`small ${name.trim().length > 1 && !nameOk ? 'field-error' : 'muted'}`}>
        {name.trim().length > 1 && !nameOk ? t.pledge.mismatch : t.pledge.signHint(p.memberName)}
      </p>
      <details>
        <summary>{t.pledge.fullText}</summary>
        <div className="agreement" lang="ar" dir="rtl" data-testid="pledge-text">{pledge.text}</div>
        <p className="muted small">{t.pledge.fingerprint}: <span className="code">{pledge.textSha256.slice(0, 16)}…</span></p>
      </details>
      <p className="muted small">{t.pledge.legal}</p>
    </section>
  );
}
