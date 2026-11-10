import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Loading, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { CIRCLE_TYPES, CategoryBadge, GOAL_TYPES } from '../categories.tsx';
import { Advisor } from './Advisor.tsx';

/** «أهدافي»: personal goals, the smart planner (goal → circle plans), and the savings-capacity advisor. */
export function Goals({ tab }: { tab: string }) {
  const { t } = useT();
  const tabs = ['goals', 'planner', 'advisor'];
  const current = tabs.includes(tab) ? tab : 'goals';
  return (
    <div className="stack">
      <h1>{t.goals.title}</h1>
      <div className="segmented" role="tablist" aria-label={t.goals.title}>
        {tabs.map((k) => <button key={k} role="tab" aria-selected={current === k} onClick={() => { location.hash = k === 'advisor' ? '/advisor' : `/goals/${k}`; }}>{t.goals.tabs[k]}</button>)}
      </div>
      {current === 'goals' && <GoalList />}
      {current === 'planner' && <Planner />}
      {current === 'advisor' && <Advisor embedded />}
    </div>
  );
}

function GoalList() {
  const { t, lang } = useT();
  const goals = useLoad(() => api<any[]>('GET', '/me/goals'));
  const circles = useLoad(() => api<any[]>('GET', '/gamiyas'));
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ category: 'HAJJ', title: '', targetAmount: '', targetDate: '', gamiyaId: '' });
  const [error, setError] = useState<unknown>(null);

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await api('POST', '/me/goals', { category: f.category, title: f.title.trim() || t.cat[f.category], targetAmount: f.targetAmount, targetDate: f.targetDate || null, gamiyaId: f.gamiyaId || null });
      setAdding(false); setF({ ...f, title: '', targetAmount: '', targetDate: '', gamiyaId: '' }); goals.reload();
    } catch (err) { setError(err); }
  }
  async function patch(id: string, body: object) {
    try { await api('POST', `/me/goals/${id}`, body); goals.reload(); } catch (err) { setError(err); }
  }

  return (
    <div className="cols">
      <section className="stack-sm" aria-live="polite">
        <ErrorNote error={goals.error} />
        {!goals.data ? <Loading /> : goals.data.length === 0 ? <p className="panel muted">{t.goals.none}</p> : (
          <ul className="goal-list">
            {goals.data.map((g) => (
              <li key={g.id} className="goal-card" data-testid="goal">
                <div className="row">
                  <span className="row-start"><CategoryBadge c={g.category} /><span className="stack-sm" style={{ gap: 0 }}>
                    <strong>{g.title}</strong>
                    <span className="muted small">{t.goals.target(money(g.targetAmount, lang, g.currency))}{g.targetDate ? ` ${t.goals.by(date(g.targetDate, lang))}` : ''}</span>
                  </span></span>
                  <span className="row-start">
                    {!g.circle && <a className="btn btn-secondary btn-xs" href={`#/goals/planner?amount=${Math.round(Number(g.targetAmount))}&date=${g.targetDate ?? ''}&type=${g.category}`}>{t.goals.plan}</a>}
                    <button className="btn btn-ghost btn-xs" onClick={() => api('POST', `/me/goals/${g.id}/remove`, {}).then(goals.reload)}>{t.goals.archive}</button>
                  </span>
                </div>
                {g.circle ? <GoalProgress g={g} /> : (
                  circles.data && circles.data.length > 0 && (
                    <label className="small">{t.goals.link}
                      <select value="" onChange={(e) => patch(g.id, { gamiyaId: e.target.value || null })}>
                        <option value="">{t.goals.noLink}</option>
                        {circles.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel stack-sm">
        {!adding ? (
          <>
            <h2>{t.goals.add}</h2>
            <div className="type-grid compact">
              {GOAL_TYPES.map((c) => (
                <button key={c} type="button" className="type-tile" onClick={() => { setF({ ...f, category: c }); setAdding(true); }}>
                  <CategoryBadge c={c} size="sm" /><span>{t.cat[c]}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <form className="stack-sm" onSubmit={add}>
            <div className="row"><h2>{t.goals.add}</h2><CategoryBadge c={f.category} size="sm" /></div>
            <label>{t.goals.kind}
              <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {[...new Set([...GOAL_TYPES, ...CIRCLE_TYPES])].map((c) => <option key={c} value={c}>{t.cat[c]}</option>)}
              </select>
            </label>
            <label>{t.goals.name}<input value={f.title} placeholder={t.cat[f.category]} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} /></label>
            <div className="grid-2">
              <label>{t.goals.amount}<input className="ltr" inputMode="numeric" required value={f.targetAmount} onChange={(e) => setF({ ...f, targetAmount: e.target.value.replace(/[^\d]/g, '') })} /></label>
              <label>{t.goals.date}<input type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></label>
            </div>
            {circles.data && circles.data.length > 0 && (
              <label>{t.goals.link}
                <select value={f.gamiyaId} onChange={(e) => setF({ ...f, gamiyaId: e.target.value })}>
                  <option value="">{t.goals.noLink}</option>
                  {circles.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <ErrorNote error={error} />
            <div className="row-start">
              <button className="btn btn-primary" disabled={!f.targetAmount}>{t.goals.save}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>{t.cancel}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function GoalProgress({ g }: { g: any }) {
  const { t, lang } = useT();
  const c = g.circle;
  const pct = c.pot ? Math.min(100, Math.round((Number(c.paid) / Number(g.targetAmount)) * 100)) : 0;
  return (
    <div className="stack-sm">
      <a href={`#/c/${c.id}`} className="small">{c.name}</a>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t.goals.paid(money(c.paid, lang, g.currency))}><span style={{ inlineSize: `${pct}%` }} /></div>
      <p className="small muted">{t.goals.paid(money(c.paid, lang, g.currency))}{c.myPayoutDate ? `${t.sep}${t.goals.payoutOn(date(c.myPayoutDate, lang))}` : ''}</p>
      <div className="row-start">
        {c.coversTarget != null && <span className={`pill ${c.coversTarget ? 'PAID' : 'LATE'}`}>{c.coversTarget ? t.goals.covers : t.goals.short}</span>}
        {c.onTime != null ? <span className={`pill ${c.onTime ? 'PAID' : 'LATE'}`}>{c.onTime ? t.goals.onTime : t.goals.late}</span>
          : !c.myPayoutDate && <span className="pill SCHEDULED">{t.goals.noTurn}</span>}
      </div>
    </div>
  );
}

function Planner() {
  const { t, lang } = useT();
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const [f, setF] = useState({ targetAmount: q.get('amount') ?? '', neededBy: q.get('date') ?? '', people: '', monthlyBudget: '', weekly: q.get('type') === 'FRIDAY', category: q.get('type') ?? 'FAMILY' });
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const num = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value.replace(/[^\d]/g, '') });

  async function run(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      setRes(await api('POST', '/ai/circle-plan', {
        targetAmount: Number(f.targetAmount), neededBy: f.neededBy || null, people: f.people ? Number(f.people) : null,
        monthlyBudget: f.monthlyBudget ? Number(f.monthlyBudget) : null, frequency: f.weekly ? 'WEEKLY' : 'MONTHLY', category: f.category,
      }));
    } catch (err) { setError(err); setRes(null); } finally { setBusy(false); }
  }
  const createHref = (p: any) => `#/new?type=${f.weekly ? 'FRIDAY' : f.category}&c=${p.contribution}&n=${p.members}&f=${p.frequency}&s=${p.startDate}`;

  return (
    <div className="cols">
      <form className="panel stack-sm" onSubmit={run}>
        <h2>{t.plan.title}</h2>
        <p className="muted small">{t.plan.intro}</p>
        <label>{t.plan.kind}
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, weekly: e.target.value === 'FRIDAY' || (f.weekly && e.target.value === f.category) })}>
            {[...new Set([...CIRCLE_TYPES, ...GOAL_TYPES])].map((c) => <option key={c} value={c}>{t.cat[c]}</option>)}
          </select>
        </label>
        <div className="grid-2">
          <label>{t.plan.amount}<input className="ltr" inputMode="numeric" required value={f.targetAmount} onChange={num('targetAmount')} /></label>
          <label>{t.plan.neededBy}<input type="date" value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></label>
        </div>
        <div className="grid-2">
          <label>{t.plan.people}<input className="ltr" inputMode="numeric" value={f.people} onChange={num('people')} /></label>
          <label>{t.plan.budget}<input className="ltr" inputMode="numeric" value={f.monthlyBudget} onChange={num('monthlyBudget')} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.checked })} />{t.plan.weekly}</label>
        <ErrorNote error={error} />
        <button className="btn btn-primary" disabled={busy || Number(f.targetAmount) < 500}>{t.plan.run}</button>
      </form>
      <section className="stack-sm" aria-live="polite" data-testid="plans">
        {res?.reason && <p className="notice gold">{t.plan.reasons[res.reason]}</p>}
        {res?.plans?.map((p: any, i: number) => (
          <article key={i} className={`plan-card${i === 0 ? ' best' : ''}`} data-testid="plan">
            <div className="row">
              <span className="row-start"><CategoryBadge c={f.weekly ? 'FRIDAY' : f.category} size="sm" /><strong>{t.plan.members(p.members)}</strong></span>
              {p.fitsBudget != null && <span className={`pill ${p.fitsBudget ? 'PAID' : 'LATE'}`}>{p.fitsBudget ? t.plan.fits : t.plan.over}</span>}
            </div>
            <div className="plan-figures">
              <div><span className="small muted">{t.contribution}</span><strong className="display">{money(String(p.contribution), lang)}</strong><span className="small muted">{t.plan.per[p.frequency]}</span></div>
              <div><span className="small muted">{t.plan.pot}</span><strong className="display">{money(String(p.pot), lang)}</strong></div>
            </div>
            <p className="small muted">{t.plan.from} {date(p.startDate, lang)}{t.sep}{t.plan.until} {date(p.endDate, lang)}</p>
            {p.latestTurnForGoal && <p className="small">{t.plan.latest(p.latestTurnForGoal, date(p.latestTurnDate, lang))}</p>}
            {p.tier === 'LARGE' && <p className="small muted">{t.tierRule.LARGE}</p>}
            <a className="btn btn-secondary" href={createHref(p)}>{t.plan.create}</a>
          </article>
        ))}
        {res && <p className="muted small">{res.note}</p>}
      </section>
    </div>
  );
}
