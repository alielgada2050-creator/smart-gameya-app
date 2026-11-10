import { useState } from 'react';
import { api, openFile, uploadFile } from '../api.ts';
import { EmptyState, ErrorNote, Loading, Pill, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { Icon } from '../shell/icons.tsx';
import { tick } from '../platform.ts';
import { celebrate } from '../illustrations/Celebration.tsx';

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

/** Smart transfer card: everything to paste into the payer's own bank or wallet app. The app never moves the money. */
function PayTo({ id }: { id: string }) {
  const { t, lang } = useT();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState('');
  const copy = (key: string, text: string) => navigator.clipboard?.writeText(text).then(() => setCopied(key)).catch(() => {});
  if (!data) return <><button type="button" className="btn btn-secondary" onClick={() => api('GET', `/installments/${id}/pay-to`).then(setData).catch(setError)}>{t.showPayTo}</button><ErrorNote error={error} /></>;
  const amount = money(data.amount, lang, data.currency);
  return (
    <div className="stack-sm transfer-card" data-testid="pay-to">
      {data.methods.length === 0 ? <p className="muted small">{t.noPayTo}</p> : (
        <>
          <p className="small">{t.payToTitle(data.recipient)}</p>
          <div className="row ref-row">
            <span><span className="muted small">{t.xfer.reference}</span><br /><strong className="code ltr" data-testid="transfer-ref">{data.reference}</strong></span>
            <button type="button" className="btn btn-ghost" onClick={() => copy('ref', data.reference)}><Icon name="copy" />{copied === 'ref' ? t.copied : t.copy}</button>
          </div>
          <ul className="list">
            {data.methods.map((m: any) => (
              <li key={m.kind + m.value} className="stack-sm">
                <div className="row">
                  <span><strong>{m.name[lang]}</strong>{m.isDefault ? <span className="muted small"> ({t.defaultTag})</span> : null}<br /><span className="ltr" style={{ display: 'inline-block' }}>{m.value}</span></span>
                  <span className="row-start">
                    <button type="button" className="btn btn-ghost" onClick={() => copy(m.kind, m.value)}><Icon name="copy" />{copied === m.kind ? t.copied : t.copy}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => copy(m.kind + '-all', [data.recipient, m.value, amount, data.reference].join('\n'))}>{copied === m.kind + '-all' ? t.copied : t.xfer.copyAll}</button>
                  </span>
                </div>
                {m.guide && (
                  <details>
                    <summary className="small">{t.xfer.steps}</summary>
                    <ol className="small" style={{ margin: '6px 0 0' }}>{m.guide.steps.map((st: any, i: number) => <li key={i}>{st[lang]}</li>)}</ol>
                    {m.guide.action && <a className="btn btn-secondary" style={{ marginTop: 8 }} href={m.guide.action.href}>{m.guide.action.label[lang]}</a>}
                    {m.guide.limitNote && <p className="notice gold small" style={{ marginTop: 8 }}>{m.guide.limitNote[lang]}</p>}
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Advisory checks shown to the organizer and the recipient; they still decide. */
function Match({ item }: { item: any }) {
  const { t, lang } = useT();
  if (!item.match) return null;
  const bad = item.match.checks.filter((c: any) => !c.ok);
  return (
    <details className={bad.length ? 'match warn' : 'match ok'} data-testid="match" open={bad.length > 0}>
      <summary className="small"><strong>{t.xfer.matchTitle}:</strong> {bad.length ? t.xfer.review(bad.length) : t.xfer.allGood}</summary>
      <ul className="small checks">
        {item.match.checks.map((c: any) => (
          <li key={c.check} className={c.ok ? 'ok' : 'bad'}>
            <span aria-hidden="true">{c.ok ? '✓' : '!'}</span> {t.xfer.checks[c.check]}
            {c.check === 'AMOUNT' && <span className="muted"> ({item.match.provided?.amount === false ? t.xfer.notProvided : `${money(item.declaredAmount, lang, item.currency)} / ${money(item.amount, lang, item.currency)}`})</span>}
            {c.check === 'DATE' && item.match.provided?.transferDate === false && <span className="muted"> ({t.xfer.notProvided})</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DeclareForm({ item, onDone }: { item: any; onDone: (msg: string) => void }) {
  const { t, lang } = useT();
  const dir = useLoad(() => api<any>('GET', `/payout-methods/directory?country=${item.country}`), [item.country]);
  const [method, setMethod] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState(String(item.amount).replace(/\.00$/, ''));
  const [when, setWhen] = useState(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const up = await uploadFile(item.gamiyaId, 'RECEIPT', file!);
      await api('POST', `/installments/${item.installmentId}/declare-paid`, { methodKind: method, receiptFileId: up.fileId, amount: amount.trim(), transferDate: when, ...(ref.trim() ? { reference: ref.trim() } : {}) });
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
      <div className="grid-2">
        <label>{t.xfer.amountSent}<input className="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} pattern="\d{1,9}(\.\d{1,2})?" required /></label>
        <label>{t.xfer.transferDate}<input type="date" value={when} onChange={(e) => setWhen(e.target.value)} required /></label>
      </div>
      <label>{t.receipt}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <ErrorNote error={error} />
      <button type="button" className="btn btn-primary" disabled={busy || !method || !file || !/^\d{1,9}(\.\d{1,2})?$/.test(amount.trim()) || !when} onClick={submit}>{t.declare}</button>
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
  const done = (m: string) => { setMsg(m); setOpen(null); ob.reload(); onChange?.(); void tick(); };

  async function act(id: string, path: string, body: object | undefined, m: string) {
    setBusy(id); setError(null); setMsg('');
    try { await api('POST', `/installments/${id}/${path}`, body); done(m); return true; } catch (e) { setError(e); return false; } finally { setBusy(null); }
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
                <Match item={i} />
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
                <Match item={i} />
                <div className="row-start">
                  {i.receiptFileId && <button className="btn btn-secondary" onClick={() => openFile(i.receiptFileId).catch(setError)}><Icon name="file" />{t.viewReceipt}</button>}
                  <button className="btn btn-primary" disabled={busy === i.installmentId} onClick={() => act(i.installmentId, 'confirm-received', undefined, t.confirmedMsg).then((ok) => ok && celebrate({ title: t.cele.paidTitle, body: t.cele.paidBody }))}>{t.confirm}</button>
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
