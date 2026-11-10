import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Ring, TierChip, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { celebrate } from '../illustrations/Celebration.tsx';

const nextMonthFirst = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
};
const CURRENCY: Record<string, string> = { SA: 'SAR', EG: 'EGP', AE: 'AED' };

export function CreateCircle() {
  const { t, lang } = useT();
  const cfg = useLoad(() => api<any>('GET', '/config/public'));
  const [f, setF] = useState({ name: '', country: 'SA', contribution: '1000', memberCount: 10, frequency: 'MONTHLY', startDate: nextMonthFirst(), graceDays: 3 });
  const [accepted, setAccepted] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const agreement = useLoad(() => api<any>('GET', '/agreements/current'));
  const currency = CURRENCY[f.country];

  // Amounts, dates and the tier come from the server preview; the form never computes them.
  useEffect(() => {
    const h = setTimeout(() => {
      api('POST', '/gamiyas/preview', { country: f.country, frequency: f.frequency, contribution: f.contribution, memberCount: Number(f.memberCount), startDate: f.startDate })
        .then((p) => { setPreview(p); setPreviewError(null); })
        .catch((e) => { setPreview(null); setPreviewError(e); });
    }, 300);
    return () => clearTimeout(h);
  }, [f.country, f.contribution, f.memberCount, f.frequency, f.startDate]);

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const c = await api<any>('POST', '/gamiyas', { ...f, memberCount: Number(f.memberCount), graceDays: Number(f.graceDays), agreementVersionId: agreement.data.id });
      location.hash = `/c/${c.id}`;
      celebrate({ title: t.cele.createdTitle, body: t.cele.createdBody });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const countries: string[] = cfg.data?.circleCountries ?? ['SA'];
  return (
    <form className="cols" onSubmit={submit}>
      <div className="stack">
        <h1>{t.newCircle}</h1>
        <div className="panel stack">
          <label>{t.name}<input value={f.name} onChange={set('name')} required minLength={2} maxLength={80} /></label>
          <div className="grid-2">
            <label>{t.country}
              <select value={f.country} onChange={set('country')}>
                {['SA', 'EG', 'AE'].map((c) => <option key={c} value={c} disabled={!countries.includes(c)}>{t.countries[c]}</option>)}
              </select>
            </label>
            <label>{t.frequency}
              <select value={f.frequency} onChange={set('frequency')}>
                {['MONTHLY', 'BIWEEKLY', 'WEEKLY'].map((x) => <option key={x} value={x}>{t.freq[x]}</option>)}
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label>{`${t.contribution} (${money('0', lang, currency).split(' ')[1]})`}<input className="ltr" inputMode="numeric" value={f.contribution} onChange={(e) => setF({ ...f, contribution: e.target.value.replace(/[^\d.]/g, '') })} required /></label>
            <label>{t.memberCount}<input className="ltr" type="number" min={2} max={60} value={f.memberCount} onChange={set('memberCount')} required /></label>
          </div>
          <div className="grid-2">
            <label>{t.startDate}<input type="date" value={f.startDate} onChange={set('startDate')} required /></label>
            <label>{t.graceDays}<input className="ltr" type="number" min={0} max={14} value={f.graceDays} onChange={set('graceDays')} /></label>
          </div>
        </div>
        <div className="panel stack-sm">
          <h3>{t.agreementTitle}</h3>
          {agreement.data && <div className="agreement" lang="ar" dir="rtl">{agreement.data.body}</div>}
          <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />{t.acceptAgreement}</label>
        </div>
      </div>

      <div className="stack">
        <div className="panel stack-sm" aria-live="polite">
          {preview ? (
            <>
              <div className="row"><h2>{t.pot}</h2><TierChip tier={preview.tier} label={t.tierName[preview.tier]} /></div>
              <Ring total={Number(f.memberCount)} members={[]} caption={t.ring} center={<>
                <text className="center-big" x="150" y="150" textAnchor="middle">{money(preview.potPerCycle, lang, currency)}</text>
                <text className="center-small" x="150" y="174" textAnchor="middle">{t.pot}</text>
              </>} />
              <dl className="kv">
                <dt>{t.pot}</dt><dd data-testid="preview-pot">{money(preview.potPerCycle, lang, currency)}</dd>
                <dt>{t.endsOn}</dt><dd>{date(preview.endDate, lang)}</dd>
              </dl>
              <p className={preview.tier === 'LARGE' ? 'notice' : 'muted small'} data-testid="tier-rule">{t.tierRule[preview.tier]}</p>
            </>
          ) : <ErrorNote error={previewError} />}
        </div>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || !accepted || !preview || !agreement.data}>{t.createCircle}</button>
      </div>
    </form>
  );
}
