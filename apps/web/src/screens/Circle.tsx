import { useState } from 'react';
import { api, type SessionUser } from '../api.ts';
import { ErrorNote, Loading, Pill, Ring, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { Obligations } from './Obligations.tsx';

export function Circle({ id }: { id: string; user: SessionUser }) {
  const { t, lang } = useT();
  const circle = useLoad(() => api<any>('GET', `/gamiyas/${id}`), [id]);
  const lottery = useLoad(() => api<any>('GET', `/gamiyas/${id}/lottery`), [id]);
  const schedule = useLoad(() => (circle.data?.status === 'ACTIVE' || circle.data?.status === 'COMPLETED' ? api<any[]>('GET', `/gamiyas/${id}/schedule`) : Promise.resolve([])), [id, circle.data?.status]);
  const reloadAll = () => { circle.reload(); lottery.reload(); schedule.reload(); };

  if (circle.error) return <ErrorNote error={circle.error} />;
  if (!circle.data) return <Loading />;
  const c = circle.data;
  const me = c.members.find((m: any) => m.memberId === c.myMemberId) ?? null;
  const cycles = schedule.data ?? [];
  const completed = cycles.findIndex((cy: any) => cy.paid < cy.total);
  const completedThrough = completed === -1 ? cycles.length : completed;
  const current = c.status === 'ACTIVE' && completed !== -1 ? cycles[completed].cycle : null;
  const myTurnCycle = cycles.find((cy: any) => cy.cycle === c.myPayoutPosition);

  return (
    <div className="stack">
      <div className="stack-sm">
        <div className="row"><h1>{c.name}</h1><Pill status={c.status} label={t.status[c.status]} /></div>
        <p className="muted">{money(c.contribution, lang)} {t.perMonth[c.frequency]}{t.sep}{t.members(c.joined, c.memberCount)}</p>
      </div>

      <section className="panel stack-sm">
        <h2>{t.ring}</h2>
        <Ring
          total={c.memberCount}
          members={c.members.map((m: any) => ({ label: m.fullName, position: m.payoutPosition, me: m === me }))}
          currentPosition={current}
          completedThrough={completedThrough}
          caption={t.ring}
          center={<>
            <text className="center-big" x="150" y="150" textAnchor="middle">{money(c.potPerCycle, lang)}</text>
            <text className="center-small" x="150" y="174" textAnchor="middle">{t.pot}</text>
          </>}
        />
        {c.myPayoutPosition ? (
          <p className="notice" data-testid="my-turn">{myTurnCycle ? t.myTurnLine(c.myPayoutPosition, date(myTurnCycle.dueDate, lang)) : `${t.yourTurn}: ${c.myPayoutPosition}`}</p>
        ) : <p className="muted small">{t.waitingDraw}</p>}
        <ol className="list" style={{ paddingInlineStart: 0 }}>
          {[...c.members].sort((a: any, b: any) => (a.payoutPosition ?? 99) - (b.payoutPosition ?? 99)).map((m: any) => (
            <li key={m.memberId} className="row">
              <span>{m.payoutPosition ? `${m.payoutPosition}. ` : ''}{m.fullName}{m === me ? ` (${t.you})` : ''}</span>
              {m.role === 'MANAGER' && <span className="muted small">{t.manager}</span>}
            </li>
          ))}
        </ol>
      </section>

      {c.status === 'COMPLETED' && <p className="notice">{t.circleDone}</p>}
      {c.myRole === 'MANAGER' && c.status === 'RECRUITING' && <Invite id={id} remaining={c.memberCount - c.joined} />}
      {(c.status === 'LOCKED' || c.status === 'RECRUITING' || lottery.data?.state === 'EXECUTED') && (
        <Lottery id={id} circle={c} state={lottery.data} onChange={reloadAll} />
      )}
      {c.status === 'ACTIVE' && <Obligations gamiyaId={id} onChange={schedule.reload} />}
      {cycles.length > 0 && (
        <section className="panel stack-sm">
          <h2>{t.schedule}</h2>
          <ul className="list">
            {cycles.map((cy: any) => (
              <li key={cy.cycle}>
                <details open={cy.cycle === current}>
                  <summary className="row" style={{ listStyle: 'none' }}>
                    <span>{cy.cycle}. {t.recipient}: <strong>{cy.recipient}</strong><br /><span className="muted small">{date(cy.dueDate, lang)}</span></span>
                    <span className="muted small">{t.paidCount(cy.paid, cy.total)}</span>
                  </summary>
                  <ul className="list" style={{ marginTop: 8 }}>
                    {cy.installments.map((i: any) => (
                      <li key={i.installmentId} className="row small"><span>{i.payer}</span><Pill status={i.status} label={t.instStatus[i.status]} /></li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Invite({ id, remaining }: { id: string; remaining: number }) {
  const { t } = useT();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function create() {
    setError(null);
    try {
      const r = await api<any>('POST', `/gamiyas/${id}/invitations`, { maxUses: Math.max(1, remaining), expiresInHours: 72 });
      setLink(`${location.origin}/#/join/${r.code}`);
    } catch (e) { setError(e); }
  }
  return (
    <section className="panel stack-sm">
      <h2>{t.invite}</h2>
      {!link ? <button className="btn-secondary" onClick={create}>{t.invite}</button> : (
        <>
          <p>{t.inviteLink}</p>
          <p className="code" data-testid="invite-link">{link}</p>
          <p className="muted small">{t.inviteUses(Math.max(1, remaining))}</p>
          <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {})}>{copied ? t.copied : t.copy}</button>
        </>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

function Lottery({ id, circle, state, onChange }: { id: string; circle: any; state: any; onChange: () => void }) {
  const { t } = useT();
  const [trial, setTrial] = useState<any>(null);
  const [entropy, setEntropy] = useState(() => `إعلان القرعة ${new Date().toISOString()}`);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const isManager = circle.myRole === 'MANAGER';
  const name = (memberId: string) => circle.members.find((m: any) => m.memberId === memberId)?.fullName ?? '?';

  async function run(fn: () => Promise<any>) {
    setBusy(true); setError(null);
    try { await fn(); onChange(); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <section className="panel stack-sm" aria-live="polite">
      <h2>{t.lottery}</h2>
      {state?.state !== 'EXECUTED' && (
        <>
          <button className="btn-secondary" disabled={busy} onClick={async () => { setError(null); try { setTrial(await api('POST', `/gamiyas/${id}/lottery/trial`)); } catch (e) { setError(e); } }}>{t.trial}</button>
          {trial && (
            <div className="stack-sm">
              <p className="muted small">{t.trialNote}</p>
              <ol className="small" style={{ margin: 0 }}>{trial.order.map((o: any) => <li key={o.memberId}>{name(o.memberId)}</li>)}</ol>
            </div>
          )}
        </>
      )}

      {circle.status === 'LOCKED' && state?.state === 'NOT_PREPARED' && isManager && (
        <button className="btn-primary" disabled={busy} onClick={() => run(() => api('POST', `/gamiyas/${id}/lottery/prepare`))}>{t.prepare}</button>
      )}

      {state?.state === 'PREPARED' && (
        <div className="stack-sm">
          <p>{t.prepared}</p>
          <p className="code" data-testid="commitment">{state.commitment}</p>
          {!state.preparedByMe && !state.approvedByMe && (
            <button className="btn-primary" disabled={busy} onClick={() => run(() => api('POST', `/gamiyas/${id}/lottery/approve`))}>{t.approve}</button>
          )}
          {!state.preparedByMe && state.approvedByMe && <p className="notice">{t.approvedWait}</p>}
          {state.preparedByMe && state.approvals === 0 && <p className="muted">{t.needApproval}</p>}
          {state.preparedByMe && state.approvals > 0 && (
            <>
              <label>{t.entropy}<input value={entropy} onChange={(e) => setEntropy(e.target.value)} minLength={8} maxLength={200} /></label>
              <button className="btn-primary" disabled={busy || entropy.trim().length < 8} onClick={() => run(() => api('POST', `/gamiyas/${id}/lottery/execute`, { publicEntropy: entropy.trim() }))}>{t.execute}</button>
            </>
          )}
        </div>
      )}

      {state?.state === 'EXECUTED' && (
        <div className="stack-sm">
          <p className={state.verification?.valid ? 'notice' : 'notice error'} data-testid="verification">{state.verification?.valid ? t.verified : t.notVerified}</p>
          <details>
            <summary>{t.verifyDetails}</summary>
            <dl className="stack-sm" style={{ marginTop: 8 }}>
              <dt className="small muted">{t.commitment}</dt><dd className="code" style={{ margin: 0 }}>{state.record.commitment}</dd>
              <dt className="small muted">{t.seed}</dt><dd className="code" style={{ margin: 0 }}>{state.record.revealedSeedHex}</dd>
              <dt className="small muted">{t.publicEntropy}</dt><dd className="code" style={{ margin: 0 }}>{state.record.publicEntropy}</dd>
            </dl>
          </details>
        </div>
      )}
      <ErrorNote error={error} />
    </section>
  );
}
