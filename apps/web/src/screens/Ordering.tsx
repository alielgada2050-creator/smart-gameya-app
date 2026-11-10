import { useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { ErrorNote, useLoad } from '../components.tsx';
import { date, useT } from '../i18n.ts';
import { celebrate } from '../illustrations/Celebration.tsx';

/**
 * How the payout order is set: verifiable draw, members' agreement, or priority with the AI assistant's suggestion.
 * Agreement and priority take effect only when every member approves (owner decision 2026-11-10).
 */
export function PayoutOrder({ id, circle, lotteryState, lotteryPanel, onChange }: { id: string; circle: any; lotteryState: any; lotteryPanel: ReactNode; onChange: () => void }) {
  const { t, lang } = useT();
  const st = useLoad(() => api<any>('GET', `/gamiyas/${id}/order`), [id, circle.status, circle.joined]);
  const s = st.data;
  const lotteryBusy = lotteryState && lotteryState.state !== 'NOT_PREPARED';
  const started = circle.status === 'ACTIVE' || circle.status === 'COMPLETED';
  const [mode, setMode] = useState<string | null>(null);
  const reload = () => { st.reload(); onChange(); };

  if (started && circle.orderingMethod === 'LOTTERY') return <>{lotteryPanel}</>;
  if (started) {
    const label = circle.orderingMethod === 'CONSENSUS' ? t.ord.modes.AGREED : t.ord.modes.PRIORITY;
    return <section className="panel"><p className="notice ok" data-testid="order-adopted">{t.ord.adopted(label)}</p></section>;
  }
  if (!s) return st.error ? <ErrorNote error={st.error} /> : null;
  const current = s.openProposal ? s.openProposal.mode : lotteryBusy ? 'LOTTERY' : mode ?? 'LOTTERY';
  const locked = !!s.openProposal || lotteryBusy;
  const lastRejected = !s.openProposal && s.history[0]?.status === 'REJECTED';

  return (
    <section className="panel stack-sm" aria-live="polite" data-testid="payout-order">
      <h2>{t.ord.title}</h2>
      {!locked && (
        <div className="segmented" role="radiogroup" aria-label={t.ord.title}>
          {['LOTTERY', 'AGREED', 'PRIORITY'].map((m) => (
            <button key={m} role="radio" aria-checked={current === m} onClick={() => setMode(m)}>{t.ord.modes[m]}</button>
          ))}
        </div>
      )}
      <p className="muted small">{t.ord.modeHint[current]}</p>
      {lastRejected && <p className="notice gold small">{t.ord.lastRejected}</p>}

      {current === 'LOTTERY' && lotteryPanel}
      {current !== 'LOTTERY' && s.openProposal && <OpenProposal id={id} p={s.openProposal} isOrganizer={s.isOrganizer} onChange={reload} />}
      {current === 'PRIORITY' && !s.openProposal && (
        <>
          <MyPriority id={id} dates={s.cycleDates ?? []} mine={s.requests.find((r: any) => r.memberId === s.myMemberId)} onSaved={st.reload} />
          <Requests requests={s.requests} lang={lang} />
          <Suggestion id={id} full={circle.status === 'LOCKED'} isOrganizer={s.isOrganizer} onChange={reload} />
        </>
      )}
      {current === 'AGREED' && !s.openProposal && (
        s.isOrganizer
          ? (circle.status === 'LOCKED' ? <BuildOrder id={id} requests={s.requests} onChange={reload} /> : <p className="muted small">{t.ord.needFull}</p>)
          : <p className="muted small">{t.ord.modeHint.AGREED}</p>
      )}
    </section>
  );
}

function MyPriority({ id, dates, mine, onSaved }: { id: string; dates: string[]; mine: any; onSaved: () => void }) {
  const { t, lang } = useT();
  const [pref, setPref] = useState<string>(mine?.declared ? mine.preference : 'NONE');
  const [neededBy, setNeededBy] = useState<string>(mine?.neededBy ?? '');
  const [reason, setReason] = useState<string>(mine?.reason ?? 'NONE');
  const [share, setShare] = useState<boolean>(!!mine?.shareReason);
  const [note, setNote] = useState<string>(mine?.note ?? '');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(!mine?.declared);
  async function save() {
    setError(null); setMsg('');
    try {
      await api('POST', `/gamiyas/${id}/order/priority`, { preference: pref, neededBy: pref === 'LATE' ? null : neededBy || null, reason, shareReason: share, ...(note.trim() ? { note: note.trim() } : {}) });
      setMsg(t.ord.saved); onSaved();
    } catch (e) { setError(e); }
  }
  return (
    <details className="sub-panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><strong>{t.ord.myPriority}</strong>{mine?.declared && <span className="muted small"> — {t.ord.pref[mine.preference]}</span>}</summary>
      <div className="stack-sm" style={{ marginTop: 8 }}>
        <h3>{t.turn.title}</h3>
        <div className="turn-picker" role="radiogroup" aria-label={t.turn.title} data-testid="turn-picker">
          {(['EARLY', 'NONE', 'LATE'] as const).map((p) => {
            const b = turnBand(p, dates.length);
            return (
              <button key={p} type="button" role="radio" aria-checked={pref === p} className={`turn-card ${p}`} onClick={() => setPref(p)}>
                <span className="turn-bar" aria-hidden="true">{dates.map((_, i) => <i key={i} className={i + 1 >= b.from && i + 1 <= b.to ? 'on' : ''} />)}</span>
                <strong>{t.turn.band[p]}</strong>
                <span className="small">{t.ord.pref[p]}</span>
                {dates.length > 0 && <span className="muted small">{t.turn.range(b.from, b.to)}{t.sep}{date(dates[b.from - 1], lang)}{b.to > b.from ? ` – ${date(dates[b.to - 1], lang)}` : ''}</span>}
              </button>
            );
          })}
        </div>
        <p className="muted small" data-testid="no-fees">{t.turn.sameForAll}</p>
        <div className="grid-2">
          {pref !== 'LATE' && <label>{t.ord.neededBy}<input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></label>}
          <label>{t.ord.reasonLabel}
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.keys(t.ord.reasons).map((r) => <option key={r} value={r}>{t.ord.reasons[r]}</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />{t.ord.shareReason}</label>
        <label>{t.ord.note}<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
        <ErrorNote error={error} />
        {msg && <p className="notice ok small">{msg}</p>}
        <button className="btn btn-secondary" onClick={save}>{t.ord.savePriority}</button>
      </div>
    </details>
  );
}

function Requests({ requests, lang }: { requests: any[]; lang: 'ar' | 'en' }) {
  const { t } = useT();
  return (
    <div className="stack-sm">
      <h3>{t.ord.requests}</h3>
      <ul className="list" data-testid="priority-requests">
        {requests.map((r) => (
          <li key={r.memberId} className="row">
            <span>{r.fullName}<br />
              <span className="muted small">
                {r.declared ? t.ord.pref[r.preference] : t.ord.notDeclared}
                {r.neededBy && `${t.sep}${t.ord.before(date(r.neededBy, lang))}`}
                {r.declared && (r.reason ? (r.reason !== 'NONE' ? `${t.sep}${t.ord.reasons[r.reason]}` : '') : `${t.sep}${t.ord.hidden}`)}
              </span>
              {r.note && <><br /><span className="small">“{r.note}”</span></>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Suggestion({ id, full, isOrganizer, onChange }: { id: string; full: boolean; isOrganizer: boolean; onChange: () => void }) {
  const { t, lang } = useT();
  const [s, setS] = useState<any>(null);
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!full) return <p className="muted small">{t.ord.needFull}</p>;
  return (
    <div className="stack-sm">
      <button className="btn btn-secondary" disabled={busy} onClick={async () => { setError(null); try { setS(await api('GET', `/gamiyas/${id}/order/suggestion`)); } catch (e) { setError(e); } }}>{t.ord.suggest}</button>
      {s && (
        <div className="stack-sm" data-testid="suggestion">
          <h3>{t.ord.suggestionTitle}</h3>
          <ol className="order-list">
            {s.order.map((o: any) => (
              <li key={o.memberId}>
                <span className="pos">{o.position}</span>
                <span>{o.fullName}<br /><span className="muted small">{date(o.payoutDate, lang)}</span></span>
                {o.needMet === true && <span className="small met">✓ {t.ord.needMet}</span>}
                {o.needMet === false && <span className="small unmet">! {t.ord.needUnmet}</span>}
                {o.needMet === null && <span />}
              </li>
            ))}
          </ol>
          <ul className="explain small muted">{s.explanation.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
          {s.summary.source === 'model' && <p className="small"><span className="muted">{t.ord.aiSummary}:</span> {s.summary.text}</p>}
          {isOrganizer && (
            <>
              <label>{t.ord.rationale}<input value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={1000} /></label>
              <button className="btn btn-primary" disabled={busy} onClick={async () => {
                setBusy(true); setError(null);
                try { await api('POST', `/gamiyas/${id}/order/proposals`, { mode: 'PRIORITY', order: s.order.map((o: any) => o.memberId), ...(rationale.trim() ? { rationale: rationale.trim() } : {}) }); onChange(); }
                catch (e) { setError(e); } finally { setBusy(false); }
              }}>{t.ord.proposeThis}</button>
            </>
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

function BuildOrder({ id, requests, onChange }: { id: string; requests: any[]; onChange: () => void }) {
  const { t } = useT();
  const [order, setOrder] = useState<any[]>(requests);
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const move = (i: number, d: number) => { const n = [...order]; [n[i], n[i + d]] = [n[i + d], n[i]]; setOrder(n); };
  return (
    <div className="stack-sm">
      <h3>{t.ord.buildOrder}</h3>
      <ol className="order-list" data-testid="build-order">
        {order.map((m, i) => (
          <li key={m.memberId}>
            <span className="pos">{i + 1}</span>
            <span>{m.fullName}</span>
            <span className="row-start">
              <button className="icon-btn" disabled={i === 0} aria-label={t.ord.moveUp(m.fullName)} onClick={() => move(i, -1)}>▲</button>
              <button className="icon-btn" disabled={i === order.length - 1} aria-label={t.ord.moveDown(m.fullName)} onClick={() => move(i, 1)}>▼</button>
            </span>
          </li>
        ))}
      </ol>
      <label>{t.ord.rationale}<input value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={1000} /></label>
      <ErrorNote error={error} />
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await api('POST', `/gamiyas/${id}/order/proposals`, { mode: 'AGREED', order: order.map((m) => m.memberId), ...(rationale.trim() ? { rationale: rationale.trim() } : {}) }); onChange(); }
        catch (e) { setError(e); } finally { setBusy(false); }
      }}>{t.ord.propose}</button>
    </div>
  );
}

function OpenProposal({ id, p, isOrganizer, onChange }: { id: string; p: any; isOrganizer: boolean; onChange: () => void }) {
  const { t, lang } = useT();
  const [objecting, setObjecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run(path: string, body?: object) {
    setBusy(true); setError(null);
    try {
      const r = await api<any>('POST', `/gamiyas/${id}/order/proposals/${p.id}/${path}`, body);
      if (r?.status === 'ADOPTED') celebrate({ title: t.cele.orderTitle, items: p.order.map((o: any) => o.fullName) });
      onChange();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack-sm turn sub-panel" data-testid="open-proposal">
      <div className="row">
        <h3>{t.ord.openTitle}</h3>
        <span className="pill">{t.ord.approvals(p.approvals, p.needed)}</span>
      </div>
      {p.aiAssisted && <p className="muted small">{t.ord.aiAssisted}</p>}
      {p.rationale && <p className="small">“{p.rationale}”</p>}
      <ol className="order-list">
        {p.order.map((o: any) => (
          <li key={o.memberId}><span className="pos">{o.position}</span><span>{o.fullName}</span><span className="muted small">{date(o.payoutDate, lang)}</span></li>
        ))}
      </ol>
      <ul className="vote-list" aria-label={t.ord.approvals(p.approvals, p.needed)}>
        {p.votes.map((v: any) => <li key={v.memberId} className={v.vote === 'APPROVE' ? 'yes' : ''}>{v.vote === 'APPROVE' ? '✓' : '…'} {v.fullName}<span className="sr-only"> {v.vote ? t.ord.approved : t.ord.waiting}</span></li>)}
      </ul>
      {p.myVote === 'APPROVE' && <p className="notice small">{t.ord.youApproved}</p>}
      {!p.myVote && (
        objecting ? (
          <div className="stack-sm">
            <label>{t.ord.objectReason}<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus /></label>
            <div className="row-start">
              <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run('vote', { vote: 'OBJECT', reason: reason.trim() })}>{t.ord.sendObjection}</button>
              <button className="btn btn-ghost" onClick={() => setObjecting(false)}>{t.cancel}</button>
            </div>
          </div>
        ) : (
          <div className="row-start">
            <button className="btn btn-primary" disabled={busy} onClick={() => run('vote', { vote: 'APPROVE' })}>{t.ord.voteApprove}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setObjecting(true)}>{t.ord.voteObject}</button>
          </div>
        )
      )}
      {isOrganizer && <button className="btn btn-ghost" disabled={busy} onClick={() => run('withdraw')}>{t.ord.withdraw}</button>}
      <ErrorNote error={error} />
    </div>
  );
}

/** Which turns each choice covers: the first third, the middle, the last third (at least one turn each). */
export function turnBand(p: 'EARLY' | 'NONE' | 'LATE', n: number) {
  if (n <= 0) return { from: 1, to: 1 };
  const third = Math.max(1, Math.floor(n / 3));
  if (p === 'EARLY') return { from: 1, to: third };
  if (p === 'LATE') return { from: n - third + 1, to: n };
  return { from: Math.min(third + 1, n), to: Math.max(third + 1, n - third) };
}
