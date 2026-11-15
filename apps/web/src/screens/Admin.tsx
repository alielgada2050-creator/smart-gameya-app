import { useState } from 'react';
import { api, openFile } from '../api.ts';
import { EmptyState, ErrorNote, Loading, Pill, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { Icon } from '../shell/icons.tsx';

/** Platform reviewers approve LARGE circles after checking each member's promissory note. */
export function Admin() {
  const { t, lang } = useT();
  const q = useLoad(() => api<any[]>('GET', '/admin/reviews'));
  const st = useLoad(() => api<any>('GET', '/admin/stats'));
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState('');

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setError(null); setMsg('');
    try {
      const r = await api<any>('POST', `/admin/gamiyas/${id}/review`, { decision, ...(note[id]?.trim() ? { note: note[id].trim() } : {}) });
      setMsg(t.approvalStatus[r.platformApproval]); q.reload();
    } catch (e) { setError(e); }
  }

  return (
    <div className="stack">
      <h1>{t.admin}</h1>
      {st.data && (
        <section className="panel stack-sm" aria-label={t.stats.title} data-testid="platform-stats">
          <h2>{t.stats.title}</h2>
          <dl className="kv">
            <dt>{t.stats.users}</dt><dd>{st.data.users.total}</dd>
            <dt>{t.stats.week}</dt><dd>{st.data.users.last7Days}</dd>
            <dt>{t.stats.month}</dt><dd>{st.data.users.last30Days}</dd>
            <dt>{t.stats.circles}</dt><dd>{st.data.circles.total}{Object.entries(st.data.circles.byStatus).map(([k, n]) => ` · ${t.status[k] ?? k} ${n}`).join('')}</dd>
            <dt>{t.stats.members}</dt><dd>{st.data.activeMembers}</dd>
            <dt>{t.stats.pending}</dt><dd>{st.data.pendingReviews}</dd>
          </dl>
        </section>
      )}
      <h2>{t.adminTitle}</h2>
      {msg && <p className="notice ok">{msg}</p>}
      <ErrorNote error={error ?? q.error} />
      {!q.data ? <Loading /> : q.data.length === 0 ? <div className="panel"><EmptyState figure="padlock" text={t.noPending} /></div> : q.data.map((c) => (
        <section key={c.id} className="panel stack-sm" data-testid="review-item">
          <div className="row"><h2>{c.name}</h2><span className="tier LARGE">{t.tierName.LARGE}</span></div>
          <p className="muted">{t.organizer}: {c.organizer}{t.sep}{t.pot}: {money(c.potPerCycle, lang, c.currency)}{t.sep}{t.members(c.memberCount, c.memberCount)}{t.sep}{date(c.startDate, lang)}</p>
          <ul className="list">
            {c.notes.map((n: any) => (
              <li key={n.id} className="row">
                <span>{n.member}<br /><span className="muted small ltr" style={{ display: 'inline-block' }}>{n.reference}</span>{t.sep}<span className="muted small">{money(n.amount, lang, c.currency)}</span></span>
                <span className="row-start"><Pill status={n.status} label={t.notesStatus[n.status]} />
                  <button className="btn btn-secondary" onClick={() => openFile(n.fileId).catch(setError)}><Icon name="file" />{t.openNote}</button></span>
              </li>
            ))}
          </ul>
          <label>{t.reviewNote}<input value={note[c.id] ?? ''} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} maxLength={500} /></label>
          <div className="row-start">
            <button className="btn btn-primary" onClick={() => decide(c.id, 'APPROVE')}>{t.approveCircle}</button>
            <button className="btn btn-danger" disabled={!(note[c.id] ?? '').trim()} onClick={() => decide(c.id, 'REJECT')}>{t.rejectCircle}</button>
          </div>
        </section>
      ))}
      <PlatformDisputes />
    </div>
  );
}

function PlatformDisputes() {
  const { t, lang } = useT();
  const q = useLoad(() => api<any[]>('GET', '/admin/disputes'));
  const [form, setForm] = useState<Record<string, { outcome: string; note: string }>>({});
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  return (
    <section className="stack-sm">
      <h2>{t.platformDisputes}</h2>
      {msg && <p className="notice ok">{msg}</p>}
      <ErrorNote error={error} />
      {!q.data ? <Loading /> : q.data.length === 0 ? <p className="muted">{t.noDisputes}</p> : q.data.map((d) => {
        const f = form[d.disputeId] ?? { outcome: 'PAYER_TO_RESEND', note: '' };
        return (
          <div key={d.disputeId} className="panel stack-sm" data-testid="platform-dispute">
            <p><strong>{d.gamiyaName}</strong>{t.sep}{money(d.amount, lang, d.currency)}{t.sep}{d.payer} {t.to} {d.recipient}</p>
            <p className="muted">{d.reason}</p>
            {d.receiptFileId && <button className="btn btn-secondary" onClick={() => openFile(d.receiptFileId).catch(setError)}><Icon name="file" />{t.viewReceipt}</button>}
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
              try { await api('POST', `/disputes/${d.disputeId}/resolve`, { outcome: f.outcome, note: f.note.trim() }); setMsg(t.resolvedMsg); q.reload(); } catch (e) { setError(e); }
            }}>{t.resolve}</button>
          </div>
        );
      })}
    </section>
  );
}
