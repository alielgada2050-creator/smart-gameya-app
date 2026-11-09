import { useState } from 'react';
import { api, uploadFile } from '../api.ts';
import { ErrorNote, Loading, Pill, Ring, TierChip, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { Icon } from '../shell/icons.tsx';
import { Obligations } from './Obligations.tsx';
import { Chat } from './Chat.tsx';

export function Circle({ id, tab }: { id: string; tab: string }) {
  const { t, lang } = useT();
  const circle = useLoad(() => api<any>('GET', `/gamiyas/${id}`), [id]);
  const lottery = useLoad(() => api<any>('GET', `/gamiyas/${id}/lottery`), [id]);
  const active = circle.data?.status === 'ACTIVE' || circle.data?.status === 'COMPLETED';
  const schedule = useLoad(() => (active ? api<any[]>('GET', `/gamiyas/${id}/schedule`) : Promise.resolve([])), [id, active]);
  const reloadAll = () => { circle.reload(); lottery.reload(); schedule.reload(); };

  if (circle.error) return <ErrorNote error={circle.error} />;
  if (!circle.data) return <Loading />;
  const c = circle.data;
  const me = c.members.find((m: any) => m.memberId === c.myMemberId) ?? null;
  const cycles = schedule.data ?? [];
  const firstOpen = cycles.findIndex((cy: any) => cy.paid < cy.total);
  const completedThrough = firstOpen === -1 ? cycles.length : firstOpen;
  const current = c.status === 'ACTIVE' && firstOpen !== -1 ? cycles[firstOpen].cycle : null;
  const myTurnCycle = cycles.find((cy: any) => cy.cycle === c.myPayoutPosition);
  const tabs = [
    { key: 'overview', label: t.tabOverview, icon: 'overview' },
    { key: 'payments', label: t.tabPayments, icon: 'pay' },
    { key: 'chat', label: t.tabChat, icon: 'chat' },
  ];

  return (
    <div className="stack">
      <div className="stack-sm">
        <div className="row">
          <h1>{c.name}</h1>
          <span className="row-start"><TierChip tier={c.tier} label={t.tierName[c.tier]} /><Pill status={c.status} label={t.status[c.status]} /></span>
        </div>
        <p className="muted">{money(c.contribution, lang, c.currency)} {t.perMonth[c.frequency]}{t.sep}{t.members(c.joined, c.memberCount)}</p>
      </div>
      <div className="segmented" role="tablist" aria-label={c.name}>
        {tabs.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} onClick={() => { location.hash = `/c/${id}/${x.key}`; }}>{x.label}</button>
        ))}
      </div>

      {tab === 'chat' && <Chat id={id} onEvent={reloadAll} />}

      {tab === 'payments' && (
        <div className="cols">
          <div className="stack">
            {c.status === 'COMPLETED' && <p className="notice ok">{t.circleDone}</p>}
            {active ? <Obligations gamiyaId={id} onChange={reloadAll} /> : <p className="muted">{t.waitingDraw}</p>}
            <Disputes id={id} circle={c} onChange={reloadAll} />
          </div>
          {cycles.length > 0 && <Schedule cycles={cycles} current={current} />}
        </div>
      )}

      {tab === 'overview' && (
        <div className="cols">
          <section className="panel stack-sm">
            <h2>{t.ring}</h2>
            <Ring total={c.memberCount} members={c.members.map((m: any) => ({ label: m.fullName, position: m.payoutPosition, me: m === me }))}
              currentPosition={current} completedThrough={completedThrough} caption={t.ring}
              center={<>
                <text className="center-big" x="150" y="150" textAnchor="middle">{money(c.potPerCycle, lang, c.currency)}</text>
                <text className="center-small" x="150" y="174" textAnchor="middle">{t.pot}</text>
              </>} />
            {c.myPayoutPosition
              ? <p className="notice" data-testid="my-turn">{myTurnCycle ? t.myTurnLine(c.myPayoutPosition, date(myTurnCycle.dueDate, lang)) : `${t.yourTurn}: ${c.myPayoutPosition}`}</p>
              : <p className="muted small">{t.waitingDraw}</p>}
            <ol className="list" style={{ paddingInlineStart: 0 }}>
              {[...c.members].sort((a: any, b: any) => (a.payoutPosition ?? 99) - (b.payoutPosition ?? 99)).map((m: any) => (
                <li key={m.memberId} className="row">
                  <span>{m.payoutPosition ? `${m.payoutPosition}. ` : ''}{m.fullName}{m === me ? ` (${t.you})` : ''}</span>
                  <span className="row-start">
                    {c.tier === 'LARGE' && m.role !== 'MANAGER' && c.notes && (() => { const n = c.notes.find((x: any) => x.memberId === m.memberId); return n ? <Pill status={n.status} label={t.notesStatus[n.status]} /> : null; })()}
                    {m.role === 'MANAGER' && <span className="muted small">{t.manager}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <div className="stack">
            {c.tier === 'LARGE' && <LargeNotes id={id} circle={c} onChange={reloadAll} />}
            {c.myRole === 'MANAGER' && c.status === 'RECRUITING' && <Invite id={id} remaining={c.memberCount - c.joined} />}
            {(c.status === 'LOCKED' || c.status === 'RECRUITING' || lottery.data?.state === 'EXECUTED') && (
              <Lottery id={id} circle={c} state={lottery.data} onChange={reloadAll} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Schedule({ cycles, current }: { cycles: any[]; current: number | null }) {
  const { t, lang } = useT();
  return (
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
                {cy.installments.map((i: any) => <li key={i.installmentId} className="row small"><span>{i.payer}</span><Pill status={i.status} label={t.instStatus[i.status]} /></li>)}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Disputes({ id, circle, onChange }: { id: string; circle: any; onChange: () => void }) {
  const { t, lang } = useT();
  const list = useLoad(() => api<any[]>('GET', `/gamiyas/${id}/disputes`), [id]);
  const [form, setForm] = useState<Record<string, { outcome: string; note: string }>>({});
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  if (!list.data || (list.data.length === 0 && !msg)) return null;
  return (
    <section className="panel stack-sm">
      <h2>{t.disputes}</h2>
      {msg && <p className="notice ok">{msg}</p>}
      <ErrorNote error={error} />
      <ul className="list">
        {list.data.map((d) => {
          const f = form[d.disputeId] ?? { outcome: 'PAYER_TO_RESEND', note: '' };
          return (
            <li key={d.disputeId} className="stack-sm">
              <p><strong>{d.payer}</strong> {t.to} <strong>{d.recipient}</strong>{t.sep}{date(d.openedAt, lang)}</p>
              <p className="muted">{d.reason}</p>
              {!d.organizerDecides && <p className="notice">{t.platformDecides}</p>}
              {circle.myRole === 'MANAGER' && d.organizerDecides && (
                <>
                  <div className="grid-2">
                    <label className="small">{t.outcome}
                      <select value={f.outcome} onChange={(e) => setForm({ ...form, [d.disputeId]: { ...f, outcome: e.target.value } })}>
                        <option value="PAYER_TO_RESEND">{t.resendOutcome}</option>
                        <option value="RECEIPT_VALID">{t.validOutcome}</option>
                      </select>
                    </label>
                    <label className="small">{t.resolutionNote}<input value={f.note} onChange={(e) => setForm({ ...form, [d.disputeId]: { ...f, note: e.target.value } })} maxLength={500} /></label>
                  </div>
                  <button className="btn btn-primary" disabled={f.note.trim().length < 3} onClick={async () => {
                    setError(null);
                    try { await api('POST', `/disputes/${d.disputeId}/resolve`, { outcome: f.outcome, note: f.note.trim() }); setMsg(t.resolvedMsg); list.reload(); onChange(); } catch (e) { setError(e); }
                  }}>{t.resolve}</button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LargeNotes({ id, circle, onChange }: { id: string; circle: any; onChange: () => void }) {
  const { t, lang } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const isOrg = circle.myRole === 'MANAGER';
  const mine = circle.notes?.find((n: any) => n.memberId === circle.myMemberId);
  const canSubmit = !isOrg && ['AWAITING_NOTES', 'REJECTED'].includes(circle.platformApproval) && mine?.status !== 'SUBMITTED';
  const allIn = (circle.notes ?? []).every((n: any) => n.status === 'SUBMITTED');
  const run = async (fn: () => Promise<any>, ok: string) => { setBusy(true); setError(null); try { await fn(); setMsg(ok); onChange(); } catch (e) { setError(e); } finally { setBusy(false); } };

  return (
    <section className="panel stack-sm" data-testid="large-notes">
      <div className="row"><h2>{t.largeTitle}</h2><Pill status={circle.platformApproval} label={t.approvalStatus[circle.platformApproval]} /></div>
      {circle.platformReviewNote && <p className="notice error">{t.reviewNote}: {circle.platformReviewNote}</p>}
      {msg && <p className="notice ok">{msg}</p>}
      <ErrorNote error={error} />
      {canSubmit && (
        <div className="stack-sm">
          <p className="small">{t.noteExplain(money(circle.potPerCycle, lang, circle.currency))}</p>
          <label>{t.noteFile}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label>{t.noteRef}<input className="ltr" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={64} /></label>
          <button className="btn btn-primary" disabled={busy || !file || ref.trim().length < 4} onClick={() => run(async () => {
            const up = await uploadFile(id, 'PROMISSORY_NOTE', file!);
            await api('POST', `/gamiyas/${id}/promissory-notes`, { fileId: up.fileId, reference: ref.trim() });
          }, t.noteSent)}>{t.submitNote}</button>
        </div>
      )}
      {isOrg && circle.platformApproval === 'AWAITING_NOTES' && (
        <button className="btn btn-primary" disabled={busy || circle.status !== 'LOCKED' || !allIn} onClick={() => run(() => api('POST', `/gamiyas/${id}/platform-review`), t.approvalStatus.PENDING)}>{t.requestReview}</button>
      )}
    </section>
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
      {!link ? <button className="btn btn-secondary" onClick={create}>{t.invite}</button> : (
        <>
          <p>{t.inviteLink}</p>
          <p className="code" data-testid="invite-link">{link}</p>
          <p className="muted small">{t.inviteUses(Math.max(1, remaining))}</p>
          <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {})}><Icon name="copy" />{copied ? t.copied : t.copy}</button>
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
  const blockedByApproval = circle.tier === 'LARGE' && circle.platformApproval !== 'APPROVED';
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
          <button className="btn btn-secondary" disabled={busy} onClick={async () => { setError(null); try { setTrial(await api('POST', `/gamiyas/${id}/lottery/trial`)); } catch (e) { setError(e); } }}>{t.trial}</button>
          {trial && (
            <div className="stack-sm">
              <p className="muted small">{t.trialNote}</p>
              <ol className="small" style={{ margin: 0 }}>{trial.order.map((o: any) => <li key={o.memberId}>{name(o.memberId)}</li>)}</ol>
            </div>
          )}
        </>
      )}
      {circle.status === 'LOCKED' && state?.state === 'NOT_PREPARED' && isManager && (
        blockedByApproval ? <p className="muted small">{t.approvalStatus[circle.platformApproval]}</p>
          : <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api('POST', `/gamiyas/${id}/lottery/prepare`))}>{t.prepare}</button>
      )}
      {state?.state === 'PREPARED' && (
        <div className="stack-sm">
          <p>{t.prepared}</p>
          <p className="code" data-testid="commitment">{state.commitment}</p>
          {!state.preparedByMe && !state.approvedByMe && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api('POST', `/gamiyas/${id}/lottery/approve`))}>{t.approve}</button>}
          {!state.preparedByMe && state.approvedByMe && <p className="notice">{t.approvedWait}</p>}
          {state.preparedByMe && state.approvals === 0 && <p className="muted">{t.needApproval}</p>}
          {state.preparedByMe && state.approvals > 0 && (
            <>
              <label>{t.entropy}<input value={entropy} onChange={(e) => setEntropy(e.target.value)} minLength={8} maxLength={200} /></label>
              <button className="btn btn-primary" disabled={busy || entropy.trim().length < 8} onClick={() => run(() => api('POST', `/gamiyas/${id}/lottery/execute`, { publicEntropy: entropy.trim() }))}>{t.execute}</button>
            </>
          )}
        </div>
      )}
      {state?.state === 'EXECUTED' && (
        <div className="stack-sm">
          <p className={state.verification?.valid ? 'notice ok' : 'notice error'} data-testid="verification">{state.verification?.valid ? t.verified : t.notVerified}</p>
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

