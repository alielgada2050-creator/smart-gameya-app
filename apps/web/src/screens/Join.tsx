import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote, useLoad } from '../components.tsx';
import { useT } from '../i18n.ts';
import { celebrate } from '../illustrations/Celebration.tsx';

export function Join({ code: initial }: { code: string }) {
  const { t } = useT();
  const [code, setCode] = useState(initial);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const agreement = useLoad(() => api<any>('GET', '/agreements/current'));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const c = await api<any>('POST', `/invitations/${encodeURIComponent(code.trim())}/accept`, { agreementVersionId: agreement.data.id });
      location.hash = `/c/${c.id}`;
      celebrate({ title: t.cele.joinedTitle, body: t.cele.joinedBody });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <form className="narrow stack" onSubmit={submit}>
      <h1>{t.join}</h1>
      <div className="panel stack">
        <label>{t.inviteCode}<input className="ltr" value={code} onChange={(e) => setCode(e.target.value)} required autoCapitalize="off" spellCheck={false} /></label>
        <h3>{t.agreementTitle}</h3>
        {agreement.data && <div className="agreement" lang="ar" dir="rtl">{agreement.data.body}</div>}
        <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />{t.acceptAgreement}</label>
      </div>
      <ErrorNote error={error} />
      <button className="btn btn-primary btn-block" disabled={busy || !accepted || !code.trim() || !agreement.data}>{t.joinCircle}</button>
    </form>
  );
}
