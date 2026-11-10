import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { ErrorNote, Ring, TierChip, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { celebrate } from '../illustrations/Celebration.tsx';
import { CIRCLE_TYPES, CategoryBadge, TEMPLATES, type Category } from '../categories.tsx';
import { PledgeSign, type PledgeSignature, type PledgeView } from '../Pledge.tsx';

const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const nextMonthFirst = () => { const d = new Date(`${riyadhToday()}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 1); return d.toISOString().slice(0, 10); };
const nextFriday = () => { const d = new Date(`${riyadhToday()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (((5 - d.getUTCDay() + 7) % 7) || 7)); return d.toISOString().slice(0, 10); };
const CURRENCY: Record<string, string> = { SA: 'SAR', EG: 'EGP', AE: 'AED' };

/** Create wizard: who the circle is for → details with a live server preview → the pledge, then create. */
export function CreateCircle({ query = '' }: { query?: string }) {
  const { t, lang } = useT();
  const q = new URLSearchParams(query);
  const fromPlan = q.has('c');
  const cfg = useLoad(() => api<any>('GET', '/config/public'));
  const agreement = useLoad(() => api<any>('GET', '/agreements/current'));
  const initialType = (q.get('type') as Category) ?? null;
  const [step, setStep] = useState(initialType ? 1 : 0);
  const [type, setType] = useState<Category | null>(initialType);
  const [f, setF] = useState(() => ({
    name: initialType ? t.cat[initialType] : '', country: 'SA',
    contribution: q.get('c') ?? (initialType ? TEMPLATES[initialType].contribution : '1000'),
    memberCount: Number(q.get('n') ?? (initialType ? TEMPLATES[initialType].memberCount : 10)),
    frequency: q.get('f') ?? (initialType ? TEMPLATES[initialType].frequency : 'MONTHLY'),
    startDate: q.get('s') ?? (initialType === 'FRIDAY' ? nextFriday() : nextMonthFirst()), graceDays: 3,
  }));
  const [accepted, setAccepted] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [pledge, setPledge] = useState<PledgeView | null>(null);
  const [sig, setSig] = useState<PledgeSignature | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const currency = CURRENCY[f.country];

  function choose(c: Category) {
    setType(c);
    const tp = TEMPLATES[c];
    setF((x) => ({ ...x, name: !x.name || Object.values(t.cat).includes(x.name) ? t.cat[c] : x.name,
      ...(fromPlan ? {} : { contribution: tp.contribution, memberCount: tp.memberCount, frequency: tp.frequency, startDate: c === 'FRIDAY' ? nextFriday() : nextMonthFirst() }) }));
  }

  // Amounts, dates and the tier come from the server preview; the form never computes them.
  useEffect(() => {
    if (step === 0) return;
    const h = setTimeout(() => {
      api('POST', '/gamiyas/preview', { country: f.country, frequency: f.frequency, contribution: f.contribution, memberCount: Number(f.memberCount), startDate: f.startDate })
        .then((p) => { setPreview(p); setPreviewError(null); })
        .catch((e) => { setPreview(null); setPreviewError(e); });
    }, 300);
    return () => clearTimeout(h);
  }, [step, f.country, f.contribution, f.memberCount, f.frequency, f.startDate]);

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const body = () => ({ ...f, memberCount: Number(f.memberCount), graceDays: Number(f.graceDays), category: type ?? 'OTHER' });

  async function toPledge(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setPledge(await api<PledgeView>('POST', '/gamiyas/pledge-preview', { name: f.name, country: f.country, frequency: f.frequency, contribution: f.contribution, memberCount: Number(f.memberCount), startDate: f.startDate }));
      setSig(null); setStep(2);
    } catch (err) { setError(err); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!sig) return;
    setBusy(true); setError(null);
    try {
      const c = await api<any>('POST', '/gamiyas', { ...body(), agreementVersionId: agreement.data.id, pledge: sig });
      location.hash = `/c/${c.id}`;
      celebrate({ title: t.cele.createdTitle, body: t.cele.createdBody });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const countries: string[] = cfg.data?.circleCountries ?? ['SA'];
  const stepper = (
    <ol className="stepper" aria-label={t.newCircle}>
      {t.wiz.steps.map((s: string, i: number) => (
        <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''}>
          <span className="dot">{i + 1}</span><span>{s}</span>
        </li>
      ))}
    </ol>
  );

  if (step === 0) {
    return (
      <div className="stack">
        <h1>{t.newCircle}</h1>
        {stepper}
        <h2>{t.wiz.chooseType}</h2>
        <div className="type-grid" role="radiogroup" aria-label={t.wiz.chooseType}>
          {CIRCLE_TYPES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={type === c} className="type-tile" onClick={() => choose(c)}>
              <CategoryBadge c={c} />
              <span className="stack-sm" style={{ gap: 0 }}><strong>{t.cat[c]}</strong><span className="muted small">{t.catHint[c]}</span></span>
            </button>
          ))}
        </div>
        <div className="wiz-actions"><button className="btn btn-primary" disabled={!type} onClick={() => setStep(1)}>{t.wiz.next}</button></div>
      </div>
    );
  }

  const previewPanel = (
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
  );

  if (step === 2 && pledge) {
    return (
      <form className="cols" onSubmit={submit}>
        <div className="stack">
          <h1>{t.newCircle}</h1>
          {stepper}
          <div className="panel"><PledgeSign pledge={pledge} onChange={setSig} /></div>
        </div>
        <div className="stack">
          {previewPanel}
          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || !sig}>{t.createCircle}</button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep(1)}>{t.wiz.back}</button>
        </div>
      </form>
    );
  }

  return (
    <form className="cols" onSubmit={toPledge}>
      <div className="stack">
        <div className="row"><h1>{t.newCircle}</h1>{type && <span className="row-start"><CategoryBadge c={type} size="sm" /><span className="muted">{t.cat[type]}</span></span>}</div>
        {stepper}
        {fromPlan && <p className="notice small">{t.wiz.fromPlan}</p>}
        {type === 'FRIDAY' && <p className="notice gold small">{t.wiz.fridayNote}</p>}
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
            <label>{t.memberCount}<input className="ltr" type="number" min={2} max={60} value={f.memberCount} onChange={(e) => setF({ ...f, memberCount: Number(e.target.value) })} required /></label>
          </div>
          <div className="grid-2">
            <label>{t.startDate}<input type="date" value={f.startDate} onChange={set('startDate')} required /></label>
            <label>{t.graceDays}<input className="ltr" type="number" min={0} max={14} value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: Number(e.target.value) })} /></label>
          </div>
        </div>
        <div className="panel stack-sm">
          <h3>{t.agreementTitle}</h3>
          {agreement.data && <div className="agreement" lang="ar" dir="rtl">{agreement.data.body}</div>}
          <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />{t.acceptAgreement}</label>
        </div>
      </div>
      <div className="stack">
        {previewPanel}
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={!accepted || !preview || !agreement.data}>{t.wiz.next}</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep(0)}>{t.wiz.back}</button>
      </div>
    </form>
  );
}
