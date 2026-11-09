import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Loading, Pill, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';

/** What the signed-in member must do now: transfers to make and receipts to confirm. Optionally scoped to one circle. */
export function Obligations({ gamiyaId, onChange }: { gamiyaId?: string; onChange?: () => void }) {
  const { t, lang } = useT();
  const ob = useLoad(() => api<any>('GET', '/me/obligations'));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});

  if (!ob.data) return ob.error ? <ErrorNote error={ob.error} /> : <Loading />;
  const scope = (xs: any[]) => (gamiyaId ? xs.filter((x) => x.gamiyaId === gamiyaId) : xs);
  const toPay = scope(ob.data.toPay).filter((i: any) => i.status !== 'SCHEDULED' || gamiyaId);
  const toConfirm = scope(ob.data.toConfirm);

  async function act(id: string, path: string, body: object | undefined, done: string) {
    setBusy(id); setError(null); setMsg('');
    try { await api('POST', `/installments/${id}/${path}`, body); setMsg(done); ob.reload(); onChange?.(); } catch (e) { setError(e); } finally { setBusy(null); }
  }

  const nothing = toPay.length === 0 && toConfirm.length === 0;
  return (
    <section className="stack-sm" aria-live="polite">
      {gamiyaId ? <h2>{t.myActions}</h2> : null}
      {msg && <p className="notice">{msg}</p>}
      <ErrorNote error={error} />
      {nothing ? <p className="muted">{t.nothingToPay}</p> : null}

      {toConfirm.length > 0 && (
        <div className="panel turn stack-sm">
          <h3>{t.toConfirm}</h3>
          <ul className="list">
            {toConfirm.map((i: any) => (
              <li key={i.installmentId} className="stack-sm">
                <div className="row">
                  <span>{money(i.amount, lang)} {t.from} <strong>{i.payer}</strong></span>
                  {!gamiyaId && <span className="muted small">{i.gamiyaName}</span>}
                </div>
                {i.reference && <span className="muted small">{t.reference}: {i.reference}</span>}
                <div className="row-start">
                  <button className="btn-primary" disabled={busy === i.installmentId} onClick={() => act(i.installmentId, 'confirm-received', undefined, t.confirmedMsg)}>{t.confirm}</button>
                  <button className="btn-danger" disabled={busy === i.installmentId} onClick={() => act(i.installmentId, 'dispute', undefined, t.disputedMsg)}>{t.dispute}</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toPay.length > 0 && (
        <div className="panel stack-sm">
          <h3>{t.toPay}</h3>
          <ul className="list">
            {toPay.slice(0, gamiyaId ? 50 : 6).map((i: any) => (
              <li key={i.installmentId} className="stack-sm">
                <div className="row">
                  <span>
                    <strong className="figure" style={{ fontSize: '1.1rem' }}>{money(i.amount, lang)}</strong> {t.to} {i.recipient}
                    <br /><span className="muted small">{!gamiyaId && `${i.gamiyaName}${t.sep}`}{date(i.dueDate, lang)}</span>
                  </span>
                  <Pill status={i.status} label={t.instStatus[i.status]} />
                </div>
                {['SCHEDULED', 'DUE', 'IN_GRACE', 'LATE'].includes(i.status) && (
                  <div className="row-start">
                    <input aria-label={t.reference} placeholder={t.reference} value={refs[i.installmentId] ?? ''} maxLength={64}
                      onChange={(e) => setRefs({ ...refs, [i.installmentId]: e.target.value })} style={{ flex: 1 }} />
                    <button className="btn-primary" disabled={busy === i.installmentId}
                      onClick={() => act(i.installmentId, 'declare-paid', refs[i.installmentId]?.trim() ? { reference: refs[i.installmentId].trim() } : {}, t.declared)}>{t.declare}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
