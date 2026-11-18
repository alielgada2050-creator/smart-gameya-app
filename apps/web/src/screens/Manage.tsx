/**
 * Before a circle starts: the organizer edits it (name, type, amount, member count, frequency, start date) and manages
 * members; members re-confirm changed terms with a new pledge, or leave with no obligation.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Loading, Pill, TierChip, useLoad } from '../components.tsx';
import { money, useT } from '../i18n.ts';
import { CIRCLE_TYPES, CategoryBadge } from '../categories.tsx';
import { PledgeSign, type PledgeSignature, type PledgeView } from '../Pledge.tsx';

export function canChange(c: any, lotteryState: any) {
  return (c.status === 'RECRUITING' || c.status === 'LOCKED') && (!lotteryState || lotteryState.state === 'NOT_PREPARED');
}

export function ReconfirmTerms({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useT();
  const p = useLoad(() => api<PledgeView>('GET', `/gamiyas/${id}/pledge`), [id]);
  const [sig, setSig] = useState<PledgeSignature | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function sign() {
    setBusy(true); setError(null);
    try { await api('POST', `/gamiyas/${id}/reconfirm`, { pledge: sig }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <section className="panel turn stack-sm" data-testid="reconfirm" aria-live="polite">
      <h2>{t.reconfirm.title}</h2>
      <p>{t.reconfirm.body}</p>
      {!p.data ? <Loading lines={3} /> : <PledgeSign pledge={p.data} onChange={setSig} compact />}
      <ErrorNote error={error ?? p.error} />
      <div className="row-start">
        <button className="btn btn-primary" disabled={!sig || busy} onClick={sign}>{t.reconfirm.sign}</button>
        <LeaveButton id={id} />
      </div>
    </section>
  );
}

export function LeaveButton({ id }: { id: string }) {
  const { t } = useT();
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function leave() {
    setError(null);
    try { await api('POST', `/gamiyas/${id}/leave`, {}); location.hash = '/circles'; } catch (e) { setError(e); }
  }
  if (!ask) return <button className="btn btn-ghost" onClick={() => setAsk(true)}>{t.manage.leave}</button>;
  return (
    <div className="stack-sm confirm-box" role="group" aria-label={t.manage.leave}>
      <p className="small">{t.manage.leaveConfirm}</p>
      <div className="row-start">
        <button className="btn btn-danger" onClick={leave}>{t.manage.yesLeave}</button>
        <button className="btn btn-ghost" onClick={() => setAsk(false)}>{t.cancel}</button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

export function RemoveMember({ id, member, onDone }: { id: string; member: any; onDone: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  async function remove() {
    setError(null);
    try { await api('POST', `/gamiyas/${id}/members/${member.memberId}/remove`, { reason: reason.trim() }); setOpen(false); onDone(); } catch (e) { setError(e); }
  }
  if (!open) return <button className="btn btn-ghost btn-xs" onClick={() => setOpen(true)} aria-label={`${t.manage.remove} ${member.fullName}`}>{t.manage.remove}</button>;
  return (
    <div className="stack-sm confirm-box" style={{ flexBasis: '100%' }}>
      <label>{t.manage.removeReason}<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>
      <div className="row-start">
        <button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={remove}>{t.manage.confirmRemove}</button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t.cancel}</button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

export function EditCircle({ id, circle, onSaved }: { id: string; circle: any; onSaved: () => void }) {
  const { t, lang } = useT();
  const initial = { name: circle.name, category: circle.category, contribution: String(Number(circle.contribution)), memberCount: circle.memberCount, frequency: circle.frequency, startDate: circle.startDate };
  const [f, setF] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pv, setPv] = useState<any>(null);
  const [pvError, setPvError] = useState<unknown>(null);
  const [sig, setSig] = useState<PledgeSignature | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  const changed = JSON.stringify(f) !== JSON.stringify(initial);

  useEffect(() => {
    if (!open || !changed) { setPv(null); return; }
    const h = setTimeout(() => {
      api('POST', `/gamiyas/${id}/edit/preview`, { ...f, memberCount: Number(f.memberCount) }).then((p) => { setPv(p); setPvError(null); }).catch((e) => { setPv(null); setPvError(e); });
    }, 300);
    return () => clearTimeout(h);
  }, [open, JSON.stringify(f)]);

  async function save() {
    setError(null); setMsg('');
    try {
      await api('POST', `/gamiyas/${id}/edit`, { ...f, memberCount: Number(f.memberCount), ...(pv?.moneyChanged ? { pledge: sig } : {}) });
      setSig(null); onSaved(); // the circle screen shows «saved»: this box remounts with the new terms
    } catch (e) { setError(e); }
  }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <details className="panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="edit-circle">
      <summary><h2>{t.edit.title}</h2></summary>
      <div className="stack-sm" style={{ marginTop: 8 }}>
        <p className="muted small">{t.edit.intro}</p>
        <label>{t.name}<input value={f.name} onChange={set('name')} minLength={2} maxLength={80} /></label>
        <label>{t.goals.kind}
          <select value={f.category} onChange={set('category')}>
            {[...CIRCLE_TYPES, 'OTHER'].map((c) => <option key={c} value={c}>{t.cat[c]}</option>)}
          </select>
        </label>
        <div className="grid-2">
          <label>{t.contribution}<input className="ltr" inputMode="numeric" value={f.contribution} onChange={(e) => setF({ ...f, contribution: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          <label>{t.memberCount}<input className="ltr" type="number" min={Math.max(2, circle.joined)} max={60} value={f.memberCount} onChange={(e) => setF({ ...f, memberCount: Number(e.target.value) })} /></label>
        </div>
        <p className="muted small">{t.edit.minMembers(circle.joined)}</p>
        <div className="grid-2">
          <label>{t.frequency}
            <select value={f.frequency} onChange={set('frequency')}>{['MONTHLY', 'BIWEEKLY', 'WEEKLY'].map((x) => <option key={x} value={x}>{t.freq[x]}</option>)}</select>
          </label>
          <label>{t.startDate}<input type="date" value={f.startDate} onChange={set('startDate')} /></label>
        </div>
        {pv && (
          <div className="stack-sm" aria-live="polite" data-testid="edit-preview">
            <dl className="kv">
              <dt>{t.pot}</dt><dd>{money(pv.terms.potPerCycle, lang, circle.currency)}</dd>
              <dt>{t.pledge.total}</dt><dd>{money(pv.terms.totalCommitment, lang, circle.currency)}</dd>
            </dl>
            {pv.tier && <TierChip tier={pv.tier} label={t.tierName[pv.tier]} />}
            {pv.moneyChanged && pv.membersToReconfirm > 0 && <p className="notice gold small">{t.edit.reconfirmWarn(pv.membersToReconfirm)}</p>}
            {pv.moneyChanged && pv.pledge && <><h3>{t.edit.signNew}</h3><PledgeSign pledge={pv.pledge} onChange={setSig} compact /></>}
          </div>
        )}
        <ErrorNote error={error ?? pvError} />
        {msg && <p className="notice ok small">{msg}</p>}
        <button className="btn btn-primary" disabled={!changed || !pv || (pv.moneyChanged && !sig)} onClick={save}>{t.edit.save}</button>
      </div>
    </details>
  );
}

/** Member row extras before the start: who still has to accept the new terms, who signed, and the organizer's remove action. */
export function MemberExtras({ id, c, m, editable, onChange }: { id: string; c: any; m: any; editable: boolean; onChange: () => void }) {
  const { t } = useT();
  return (
    <>
      {m.status === 'PENDING_APPROVAL' && <Pill status="PENDING" label={t.manage.pending} />}
      {m.status === 'ACTIVE' && m.pledged && c.status !== 'ACTIVE' && c.status !== 'COMPLETED' && (
        <span className="signed-mark" title={t.manage.pledged} aria-label={t.manage.pledged}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
      )}
      {editable && c.myRole === 'MANAGER' && m.role !== 'MANAGER' && <RemoveMember id={id} member={m} onDone={onChange} />}
    </>
  );
}

export function CircleTitleBadge({ c }: { c: any }) {
  return <CategoryBadge c={c.category ?? 'OTHER'} size="md" />;
}
