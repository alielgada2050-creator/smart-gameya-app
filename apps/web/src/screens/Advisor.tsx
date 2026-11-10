import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote } from '../components.tsx';
import { money, useT } from '../i18n.ts';

export function Advisor({ embedded = false }: { embedded?: boolean }) {
  const { t, lang } = useT();
  const [f, setF] = useState({ monthlyIncome: '', monthlyExpenses: '', goalAmount: '', targetMonths: '' });
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const num = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value.replace(/[^\d]/g, '') });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      setRes(await api('POST', '/ai/savings-advice', {
        monthlyIncome: f.monthlyIncome, monthlyExpenses: f.monthlyExpenses, goalAmount: f.goalAmount,
        ...(f.targetMonths ? { targetMonths: Number(f.targetMonths) } : {}),
      }));
    } catch (err) { setError(err); setRes(null); } finally { setBusy(false); }
  }

  const facts = res?.facts;
  return (
    <div className="narrow stack">
      <div className="stack-sm">
        {embedded ? <h2>{t.advisorTitle}</h2> : <h1>{t.advisorTitle}</h1>}
        <p className="muted">{t.advisorIntro}</p>
      </div>
      <form className="panel stack" onSubmit={submit}>
        <div className="grid-2">
          <label>{t.income}<input inputMode="numeric" value={f.monthlyIncome} onChange={num('monthlyIncome')} required autoComplete="off" /></label>
          <label>{t.expenses}<input inputMode="numeric" value={f.monthlyExpenses} onChange={num('monthlyExpenses')} required autoComplete="off" /></label>
        </div>
        <div className="grid-2">
          <label>{t.goal}<input inputMode="numeric" value={f.goalAmount} onChange={num('goalAmount')} required autoComplete="off" /></label>
          <label>{t.targetMonths}<input inputMode="numeric" value={f.targetMonths} onChange={num('targetMonths')} maxLength={2} autoComplete="off" /></label>
        </div>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || !f.monthlyIncome || !f.monthlyExpenses || !f.goalAmount}>{t.ask}</button>
      </form>

      {facts && (
        <section className="stack" aria-live="polite" data-testid="advice">
          <div className={`panel stack-sm ${facts.status === 'NOT_ADVISED' ? '' : 'turn'}`}>
            {facts.recommended ? (
              <>
                <h2>{t.recommendation}</h2>
                <p className="figure">{money(facts.recommended.monthlyContribution, lang)} {t.perMonth.MONTHLY}</p>
                <p>{t.scenarioRow(facts.recommended.members)}{t.sep}{t.pot}: {money(facts.recommended.payout, lang)}</p>
              </>
            ) : null}
            <p style={{ whiteSpace: 'pre-line' }}>{res.explanation.text}</p>
            <p className="muted small">{res.explanation.source === 'llm' ? t.aiWrote(res.explanation.provider) : t.templateWrote}</p>
          </div>
          <dl className="panel kv">
            <dt>{t.capacity}</dt><dd>{money(facts.comfortableMonthlyCapacity, lang)}</dd>
            <dt>{t.existing}</dt><dd>{money(facts.existingMonthlyCommitments, lang)}</dd>
            <dt>{t.remaining}</dt><dd>{money(facts.remainingCapacity, lang)}</dd>
          </dl>
          <ul className="list panel">
            {facts.scenarios.map((s: any) => (
              <li key={s.members} className="row">
                <span>{t.scenarioRow(s.members)}<br /><span className="muted small">{money(s.monthlyContribution, lang)} {t.perMonth.MONTHLY}</span></span>
                <span className={`pill ${s.affordable ? '' : 'late'}`}>{!s.affordable ? t.notAffordable : !s.fitsTarget ? t.outsideTarget : t.affordable}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">{res.disclaimer}</p>
        </section>
      )}
    </div>
  );
}
