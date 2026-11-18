/**
 * «تبديل عضو بعضو»: the organizer or a member starts a replacement, the other side agrees, the organizer shares a link,
 * and the newcomer opens it, sees exactly what they take over, signs, and takes the seat. Works before and after the start.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Loading, TierChip, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { celebrate } from '../illustrations/Celebration.tsx';
import { CategoryBadge } from '../categories.tsx';
import { PledgeSign, type PledgeSignature } from '../Pledge.tsx';
import { WEB_ORIGIN } from '../platform.ts';

/** True while a seat can still change hands (the server has the final word). */
export const replaceable = (c: any) => ['RECRUITING', 'LOCKED', 'ACTIVE'].includes(c.status);

/** «استبدال» on a member row (organizer), or «اطلب من يحلّ محلي» for your own seat. */
export function ReplaceMember({ id, member, self = false, onDone }: { id: string; member: any; self?: boolean; onDone: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true); setError(null);
    try { await api('POST', `/gamiyas/${id}/members/${member.memberId}/replace`, { reason: reason.trim() }); setOpen(false); setReason(''); onDone(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  const title = self ? t.seat.askMine : t.seat.replace;
  if (!open) return <button className={self ? 'btn btn-secondary' : 'btn btn-ghost btn-xs'} onClick={() => setOpen(true)} aria-label={self ? title : `${title} ${member.fullName}`}>{title}</button>;
  return (
    <div className="stack-sm confirm-box" role="group" aria-label={title}>
      <p className="small">{self ? t.seat.askMineHelp : t.seat.replaceHelp(member.fullName)}</p>
      <label>{t.seat.reason}<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus /></label>
      <ErrorNote error={error} />
      <div className="row-start">
        <button className="btn btn-primary" disabled={busy || reason.trim().length < 3} onClick={start}>{t.seat.start}</button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>{t.cancel}</button>
      </div>
    </div>
  );
}

/** Open replacements: who agreed, what is missing, and the link to send once both sides agreed. */
export function SeatTransfers({ id, circleName, reloadKey, onChange }: { id: string; circleName: string; reloadKey: unknown; onChange: () => void }) {
  const { t } = useT();
  const list = useLoad(() => api<any[]>('GET', `/gamiyas/${id}/seat-transfers`), [id, reloadKey]);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState('');
  if (!list.data?.length) return null;
  const act = async (path: string) => { setError(null); try { await api('POST', path, {}); list.reload(); onChange(); } catch (e) { setError(e); } };
  return (
    <section className="panel stack-sm" data-testid="seat-transfers" aria-live="polite">
      <h2>{t.seat.title}</h2>
      <ErrorNote error={error} />
      <ul className="list">
        {list.data.map((s) => {
          const link = s.code ? `${WEB_ORIGIN}/#/seat/${s.code}` : '';
          const canApprove = s.mine ? !s.outgoingConsent : !s.organizerApproved && !s.mine;
          return (
            <li key={s.id} className="stack-sm">
              <div className="row"><strong>{t.seat.replacing(s.fullName)}</strong><span className="muted small">{s.reason}</span></div>
              <p className="small">
                <span className={`pill ${s.outgoingConsent ? 'PAID' : 'PENDING'}`}>{s.outgoingConsent ? t.seat.memberAgreed : t.seat.memberWaiting}</span>{' '}
                <span className={`pill ${s.organizerApproved ? 'PAID' : 'PENDING'}`}>{s.organizerApproved ? t.seat.orgApproved : t.seat.orgWaiting}</span>
              </p>
              {s.ready ? (
                <div className="stack-sm">
                  <p className="small">{t.seat.sendLink}</p>
                  <div className="row-start">
                    <code className="ltr small seat-link">{link}</code>
                    <button className="btn btn-secondary btn-xs" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(s.id); }}>{copied === s.id ? t.seat.copied : t.seat.copy}</button>
                    <a className="btn btn-secondary btn-xs" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(t.seat.shareText(circleName, s.fullName, link))}`}>{t.share.whatsapp}</a>
                  </div>
                </div>
              ) : canApprove && (
                <button className="btn btn-primary btn-xs" onClick={() => act(`/seat-transfers/${s.id}/approve`)}>{s.mine ? t.seat.iAgree : t.seat.approve}</button>
              )}
              <button className="btn btn-ghost btn-xs" onClick={() => act(`/seat-transfers/${s.id}/cancel`)}>{s.mine && !s.outgoingConsent ? t.seat.refuse : t.seat.cancel}</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The newcomer's page: the seat in numbers (turn, payments left, overdue), the agreement and the pledge, then take the seat. */
export function TakeSeat({ code }: { code: string }) {
  const { t, lang } = useT();
  const seat = useLoad(() => api<any>('GET', `/seat-transfers/code/${encodeURIComponent(code)}`), [code]);
  const agreement = useLoad(() => api<any>('GET', '/agreements/current'));
  const [accepted, setAccepted] = useState(false);
  const [sig, setSig] = useState<PledgeSignature | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const c = await api<any>('POST', `/seat-transfers/code/${encodeURIComponent(code)}/accept`, { agreementVersionId: agreement.data.id, pledge: sig });
      location.hash = `/c/${c.id}`;
      celebrate({ title: t.seat.doneTitle, body: t.seat.doneBody });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  if (seat.error) return <div className="narrow stack"><h1>{t.seat.takeTitle}</h1><p className="notice error" role="alert">{t.seat.invalid}</p></div>;
  if (!seat.data) return <div className="narrow"><Loading lines={4} /></div>;
  const c = seat.data.circle, s = seat.data.seat;
  return (
    <form className="narrow stack" onSubmit={submit} data-testid="take-seat">
      <h1>{t.seat.takeTitle}</h1>
      <section className="invite-card">
        <div className="row-start"><CategoryBadge c={c.category} size="lg" />
          <div className="stack-sm" style={{ gap: 0 }}><strong className="display">{c.name}</strong><span className="small">{t.join2.organizer}: {c.organizerName}</span></div>
        </div>
        <p>{t.seat.youReplace(s.replaces)}{s.payoutPosition ? ` — ${t.seat.turn(s.payoutPosition)}` : ''}</p>
        <div className="invite-figures">
          <div><span className="small">{t.seat.left}</span><strong>{s.installments}</strong><span className="small">{money(c.contribution, lang, c.currency)} {t.perMonth[c.frequency]}</span></div>
          <div><span className="small">{t.seat.total}</span><strong>{money(s.total, lang, c.currency)}</strong><span className="small">{t.pot}: {money(c.potPerCycle, lang, c.currency)}</span></div>
        </div>
        <p className="small">{date(s.firstDue, lang)} – {date(c.endDate, lang)}</p>
        <TierChip tier={c.tier} label={t.tierName[c.tier]} />
      </section>
      {s.overdue > 0 && <p className="notice error">{t.seat.overdue(s.overdue)}</p>}
      <p className="notice gold small">{t.seat.privateSettle(s.replaces)}</p>
      {seat.data.alreadyMember ? <p className="notice ok">{t.join2.already}</p> : (
        <>
          <div className="panel stack-sm">
            <h3>{t.agreementTitle}</h3>
            {agreement.data && <div className="agreement" lang="ar" dir="rtl">{agreement.data.body}</div>}
            <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />{t.acceptAgreement}</label>
          </div>
          <div className="panel"><PledgeSign pledge={seat.data.pledge} onChange={setSig} /></div>
          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || !accepted || !sig || !agreement.data}>{t.seat.take}</button>
        </>
      )}
    </form>
  );
}
