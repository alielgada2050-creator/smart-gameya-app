import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Ring, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';

const nextMonthFirst = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
};

export function CreateCircle() {
  const { t, lang } = useT();
  const [f, setF] = useState({ name: '', contribution: '1000', memberCount: 10, frequency: 'MONTHLY', startDate: nextMonthFirst(), graceDays: 3 });
  const [accepted, setAccepted] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const agreement = useLoad(() => api<any>('GET', '/agreements/current'));

  // Figures come from the server preview; the form never computes them.
  useEffect(() => {
    const h = setTimeout(() => {
      api('POST', '/gamiyas/preview', { currency: 'SAR', frequency: f.frequency, contribution: f.contribution, memberCount: Number(f.memberCount), startDate: f.startDate })
        .then((p) => { setPreview(p); setPreviewError(null); })
        .catch((e) => { setPreview(null); setPreviewError(e); });
    }, 300);
    return () => clearTimeout(h);
  }, [f.contribution, f.memberCount, f.frequency, f.startDate]);

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const c = await api<any>('POST', '/gamiyas', { ...f, memberCount: Number(f.memberCount), graceDays: Number(f.graceDays), currency: 'SAR', agreementVersionId: agreement.data.id });
      location.hash = `/c/${c.id}`;
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t.newCircle}</h1>
      <div className="panel stack">
        <label>{t.name}<input value={f.name} onChange={set('name')} required minLength={2} maxLength={80} /></label>
        <div className="grid-2">
          <label>{t.contribution}<input inputMode="numeric" value={f.contribution} onChange={(e) => setF({ ...f, contribution: e.target.value.replace(/[^\d.]/g, '') })} required /></label>
          <label>{t.memberCount}<input type="number" min={2} max={60} value={f.memberCount} onChange={set('memberCount')} required /></label>
        </div>
        <div className="grid-2">
          <label>{t.frequency}
            <select value={f.frequency} onChange={set('frequency')}>
              {['MONTHLY', 'BIWEEKLY', 'WEEKLY'].map((x) => <option key={x} value={x}>{t.freq[x]}</option>)}
            </select>
          </label>
          <label>{t.startDate}<input type="date" value={f.startDate} onChange={set('startDate')} required /></label>
        </div>
        <label>{t.graceDays}<input type="number" min={0} max={14} value={f.graceDays} onChange={set('graceDays')} /></label>
      </div>

      <div className="panel stack-sm" aria-live="polite">
        {preview ? (
          <>
            <Ring total={Number(f.memberCount)} members={[]} caption={t.ring} center={<>
              <text className="center-big" x="150" y="150" textAnchor="middle">{money(preview.potPerCycle, lang)}</text>
              <text className="center-small" x="150" y="174" textAnchor="middle">{t.pot}</text>
            </>} />
            <dl className="kv">
              <dt>{t.pot}</dt><dd data-testid="preview-pot">{money(preview.potPerCycle, lang)}</dd>
              <dt>{t.endsOn}</dt><dd>{date(preview.endDate, lang)}</dd>
            </dl>
          </>
        ) : <ErrorNote error={previewError} />}
      </div>

      <div className="panel stack-sm">
        <h3>{t.agreementTitle}</h3>
        {agreement.data && <div className="agreement" lang="ar" dir="rtl">{agreement.data.body}</div>}
        <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />{t.acceptAgreement}</label>
      </div>
      <ErrorNote error={error} />
      <button className="btn-primary btn-block" disabled={busy || !accepted || !preview || !agreement.data}>{t.createCircle}</button>
    </form>
  );
}
