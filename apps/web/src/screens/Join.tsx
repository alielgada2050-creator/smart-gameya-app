import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Loading, TierChip, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { celebrate } from '../illustrations/Celebration.tsx';
import { CategoryBadge } from '../categories.tsx';
import { PledgeSign, type PledgeSignature } from '../Pledge.tsx';

/** Join by invitation: see the circle in numbers and who organizes it, read the agreement, sign the pledge, join. */
export function Join({ code: initial }: { code: string }) {
  const { t, lang } = useT();
  const [code, setCode] = useState(initial);
  const [shown, setShown] = useState(initial.trim());
  const [accepted, setAccepted] = useState(false);
  const [sig, setSig] = useState<PledgeSignature | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const agreement = useLoad(() => api<any>('GET', '/agreements/current'));
  const inv = useLoad(() => (shown ? api<any>('GET', `/invitations/${encodeURIComponent(shown)}`) : Promise.resolve(null)), [shown]);
  useEffect(() => { setSig(null); }, [shown]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!inv.data) { setShown(code.trim()); return; }
    setBusy(true); setError(null);
    try {
      const c = await api<any>('POST', `/invitations/${encodeURIComponent(shown)}/accept`, { agreementVersionId: agreement.data.id, pledge: sig });
      location.hash = `/c/${c.id}`;
      celebrate({ title: t.cele.joinedTitle, body: t.cele.joinedBody });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const c = inv.data?.circle;
  return (
    <form className="narrow stack" onSubmit={submit}>
      <h1>{c ? t.join2.title : t.join}</h1>
      <div className="panel stack-sm">
        <label>{t.inviteCode}<input className="ltr" value={code} onChange={(e) => { setCode(e.target.value); }} onBlur={() => code.trim() && setShown(code.trim())} required autoCapitalize="off" spellCheck={false} /></label>
        {!c && <button type="button" className="btn btn-secondary" onClick={() => setShown(code.trim())} disabled={!code.trim()}>{t.join2.check}</button>}
        {shown && inv.error ? <p className="notice error" role="alert">{t.join2.invalid}</p> : null}
      </div>
      {shown && !inv.data && !inv.error && <Loading lines={3} />}
      {c && (
        <>
          <section className="invite-card" data-testid="invite-card">
            <div className="row-start"><CategoryBadge c={c.category} size="lg" />
              <div className="stack-sm" style={{ gap: 0 }}>
                <strong className="display">{c.name}</strong>
                <span className="small">{t.join2.organizer}: {c.organizerName}</span>
              </div>
            </div>
            <div className="invite-figures">
              <div><span className="small">{t.contribution}</span><strong>{money(c.contribution, lang, c.currency)}</strong><span className="small">{t.perMonth[c.frequency]}</span></div>
              <div><span className="small">{t.pot}</span><strong>{money(c.potPerCycle, lang, c.currency)}</strong><span className="small">{t.members(c.joined, c.memberCount)}</span></div>
            </div>
            <p className="small">{date(c.startDate, lang)} – {date(c.endDate, lang)}</p>
            <TierChip tier={c.tier} label={t.tierName[c.tier]} />
          </section>
          {inv.data.alreadyMember ? <p className="notice ok">{t.join2.already}</p> : (
            <>
              <div className="panel stack-sm">
                <h3>{t.agreementTitle}</h3>
                {agreement.data && <div className="agreement" lang="ar" dir="rtl">{agreement.data.body}</div>}
                <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />{t.acceptAgreement}</label>
              </div>
              <div className="panel"><PledgeSign pledge={inv.data.pledge} onChange={setSig} /></div>
              <ErrorNote error={error} />
              <button className="btn btn-primary btn-block" disabled={busy || !accepted || !sig || !agreement.data}>{t.joinCircle}</button>
            </>
          )}
        </>
      )}
    </form>
  );
}
