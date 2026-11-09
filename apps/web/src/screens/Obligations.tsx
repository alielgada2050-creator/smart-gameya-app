import { useState } from 'react';
import { api, openFile, uploadFile } from '../api.ts';
import { EmptyState, ErrorNote, Loading, Pill, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { Icon } from '../shell/icons.tsx';

/** Three-step progress: sender declared → organizer approved (when required) → recipient confirmed. */
function Steps({ status, needsOrganizer }: { status: string; needsOrganizer: boolean }) {
  const { t } = useT();
  const declared = ['AWAITING_ORGANIZER', 'AWAITING_CONFIRMATION', 'DISPUTED', 'PAID'].includes(status);
  const orgDone = !needsOrganizer || ['AWAITING_CONFIRMATION', 'DISPUTED', 'PAID'].includes(status);
  const cls = (done: boolean, now: boolean) => (done ? 'done' : now ? 'now' : '');
  return (
    <div className="steps" role="img" aria-label={t.stepsLabel}>
      <span className={cls(declared, !declared)} />
      <span className={cls(declared && orgDone, declared && !orgDone)} />
      <span className={cls(status === 'PAID', declared && orgDone && status !== 'PAID')} />
    </div>
  );
}

function PayTo({ id }: { id: string }) {
  const { t, lang } = useT();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState('');
  if (!data) return <button type="button" className="btn btn-secondary" onClick={() => api('GET', `/installments/${id}/pay-to`).then(setData).catch(setError)}>{t.showPayTo}</button>;
  return (
    <div className="stack-sm" data-testid="pay-to">
      <ErrorNote error={error} />
      {data.methods.length === 0 ? <p className="muted small">{t.noPayTo}</p> : (
        <>
          <p className="small">{t.payToTitle(data.recipient)}</p>
          <ul className="list">
            {data.methods.map((m: any) => (
              <li key={m.kind + m.value} className="row">
                <span><strong>{m.name[lang]}</strong>{m.isDefault ? <span className="muted small"> ({t.defaultTag})</span> : null}<br /><span className="ltr" style={{ display: 'inline-block' }}>{m.value}</span></span>
                <button type="button" className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(m.value).then(() => setCopied(m.value)).catch(() => {})}>
                  <Icon name="copy" />{copied === m.value ? t.copied : t.copy}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DeclareForm({ item, onDone }: { item: any; onDone: (msg: string) => void }) {
  const { t, lang } = useT();
  const dir = useLoad(() => api<any>('GET', `/payout-methods/directory?country=${item.country}`), [item.country]);
  const [method, setMethod] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const up = await uploadFile(item.gamiyaId, 'RECEIPT', file!);
      await api('POST', `/installments/${item.installmentId}/declare-paid`, { methodKind: method, receiptFileId: up.fileId, ...(ref.trim() ? { reference: ref.trim() } : {}) });
      onDone(t.declared);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <div className="stack-sm">
      <PayTo id={item.installmentId} />
      <div className="grid-2">
        <label>{t.method}
          <select value={method} onChange={(e) => setMethod(e.target.value)} required>
            <option value="" disabled>—</option>
            {(dir.data?.methods ?? []).map((m: any) => <option key={m.kind} value={m.kind}>{m.name[lang]}</option>)}
            <option value="OTHER">{t.other}</option>
          </select>
        </label>
        <label>{t.reference}<input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={64} /></label>
      </div>
      <label>{t.receipt}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <ErrorNote error={error} />
      <button type="button" className="btn btn-primary" disabled={busy || !method || !file} onClick={submit}>{t.declare}</button>
    </div>
  );
}

/** What the signed-in member must do now. Optionally scoped to one circle. */
export function Obligations({ gamiyaId, onChange }: { gamiyaId?: string; onChange?: () => void }) {
  const { t, lang } = useT();
  const ob = useLoad(() => api<any>('GET', '/me/obligations'));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  if (!ob.data) return ob.error ? <ErrorNote error={ob.error} /> : <Loading />;
  const scope = (xs: any[]) => (gamiyaId ? xs.filter((x) => x.gamiyaId === gamiyaId) : xs);
  const toPay = scope(ob.data.toPay).filter((i: any) => gamiyaId || i.status !== 'SCHEDULED');
  const toApprove = scope(ob.data.toApprove);
  const toConfirm = scope(ob.data.toConfirm);
  const done = (m: string) => { setMsg(m); setOpen(null); ob.reload(); onChange?.(); };

  async function act(id: string, path: string, body: object | undefined, m: string) {
    setBusy(id); setError(null); setMsg('');
    try { await api('POST', `/installments/${id}/${path}`, body); done(m); } catch (e) { setError(e); } finally { setBusy(null); }
  }

  const head = (i: any, who: string) => (
    <div className="row">
      <span><strong className="figure" style={{ fontSize: '1.05rem' }}>{money(i.amount, lang, i.currency)}</strong> {who}
        <br /><span className="muted small">{!gamiyaId && `${i.gamiyaName}${t.sep}`}{date(i.dueDate, lang)}</span></span>
      <Pill status={i.status} label={t.instStatus[i.status]} />
    </div>
  );
  const reasonInput = (id: string, label: string) => (
    <label className="small">{label}<input value={reason[id] ?? ''} onChange={(e) => setReason({ ...reason, [id]: e.target.value })} maxLength={500} /></label>
  );

  return (
    <section className="stack-sm" aria-live="polite">
      {gamiyaId ? <h2>{t.myActions}</h2> : null}
      {msg && <p className="notice ok">{msg}</p>}
      <ErrorNote error={error} />
      {toPay.length + toApprove.length + toConfirm.length === 0 && <div className="panel"><EmptyState figure="settle" text={t.nothingToPay} /></div>}

      {toApprove.length > 0 && (
        <div className="panel turn stack-sm">
          <h3>{t.toApprove}</h3>
          <ul className="list">
            {toApprove.map((i: any) => (
              <li key={i.installmentId} className="stack-sm">
                {head(i, `${t.from} ${i.payer} ${t.to} ${i.recipient}`)}
                <Steps status={i.status} needsOrganizer={i.needsOrganizer} />
                <div className="row-start">
                  {i.receiptFileId && <button className="btn btn-secondary" onClick={() => openFile(i.receiptFileId).catch(setError)}><Icon name="file" />{t.viewReceipt}</button>}
                  <button className="btn btn-primary" disabled={busy === i.installmentId} onClick={() => act(i.installmentId, 'organizer-approve', undefined, t.approvedMsg)}>{t.approveReceipt}</button>
                </div>
                {reasonInput(i.installmentId, t.rejectReason)}
                <button className="btn btn-danger" disabled={busy === i.installmentId || (reason[i.installmentId] ?? '').trim().length < 3}
                  onClick={() => act(i.installmentId, 'organizer-reject', { reason: reason[i.installmentId].trim() }, t.rejectedMsg)}>{t.rejectReceipt}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toConfirm.length > 0 && (
        <div className="panel turn stack-sm">
          <h3>{t.toConfirm}</h3>
          <ul className="list">
            {toConfirm.map((i: any) => (
              <li key={i.installmentId} className="stack-sm">
                {head(i, `${t.from} ${i.payer}`)}
                <Steps status={i.status} needsOrganizer={i.needsOrganizer} />
                {i.reference && <span className="muted small">{t.reference}: {i.reference}</span>}
                <div className="row-start">
                  {i.receiptFileId && <button className="btn btn-secondary" onClick={() => openFile(i.receiptFileId).catch(setError)}><Icon name="file" />{t.viewReceipt}</button>}
                  <button className="btn btn-primary" disabled={busy === i.installmentId} onClick={() => act(i.installmentId, 'confirm-received', undefined, t.confirmedMsg)}>{t.confirm}</button>
                </div>
                {reasonInput(i.installmentId, t.disputeReason)}
                <button className="btn btn-danger" disabled={busy === i.installmentId || (reason[i.installmentId] ?? '').trim().length < 3}
                  onClick={() => act(i.installmentId, 'dispute', { reason: reason[i.installmentId].trim() }, t.disputedMsg)}>{t.dispute}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toPay.length > 0 && (
        <div className="panel stack-sm">
          <h3>{t.toPay}</h3>
          <ul className="list">
            {toPay.slice(0, gamiyaId ? 60 : 6).map((i: any) => (
              <li key={i.installmentId} className="stack-sm">
                {head(i, `${t.to} ${i.recipient}`)}
                <Steps status={i.status} needsOrganizer={i.needsOrganizer} />
                {['SCHEDULED', 'DUE', 'IN_GRACE', 'LATE'].includes(i.status) && (
                  open === i.installmentId
                    ? <DeclareForm item={i} onDone={done} />
                    : <button className="btn btn-primary" onClick={() => setOpen(i.installmentId)}>{t.recordTransfer}</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
