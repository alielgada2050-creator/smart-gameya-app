import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { EmptyState, ErrorNote, Loading, useLoad } from '../components.tsx';
import { useT } from '../i18n.ts';
import { readLogos, saveLogos, type OrgLogo } from '../shell/prefs.ts';
import { useInstall } from '../shell/Shell.tsx';
import { Icon } from '../shell/icons.tsx';
import { isNative } from '../platform.ts';

export function Account() {
  const { t } = useT();
  const me = useLoad(() => api<any>('GET', '/auth/me'));
  return (
    <div className="cols">
      <div className="stack">
        <h1>{t.accountTitle}</h1>
        {me.data ? (
          <dl className="panel kv">
            <dt>{t.fullName}</dt><dd>{me.data.fullName}</dd>
            {me.data.phone && <><dt>{t.phone}</dt><dd className="ltr">{me.data.phone}</dd></>}
            <dt>Google</dt><dd>{me.data.googleLinked ? `${t.googleLinked}${me.data.email ? ` (${me.data.email})` : ''}` : t.googleNotLinked}</dd>
          </dl>
        ) : <Loading />}
        <PayoutMethods />
      </div>
      <div className="stack">
        {!isNative && <AppOnDevices />}
        <BusinessIdentity />
      </div>
    </div>
  );
}

function PayoutMethods() {
  const { t, lang } = useT();
  const mine = useLoad(() => api<any[]>('GET', '/me/payout-methods'));
  const [country, setCountry] = useState('SA');
  const dir = useLoad(() => api<any>('GET', `/payout-methods/directory?country=${country}`), [country]);
  const [kind, setKind] = useState('');
  const [value, setValue] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const spec = dir.data?.methods.find((m: any) => m.kind === kind);
  const all = useLoad(() => api<any>('GET', '/payout-methods/directory'));
  const nameOf = (k: string) => all.data?.methods.find((m: any) => m.kind === k)?.name[lang] ?? k;

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try { await api('POST', '/me/payout-methods', { country, kind, value, isDefault }); setValue(''); mine.reload(); } catch (err) { setError(err); }
  }

  return (
    <section className="panel stack-sm">
      <h2>{t.payoutMethods}</h2>
      <p className="muted small">{t.payoutExplain}</p>
      {mine.data && mine.data.length > 0 && (
        <ul className="list" data-testid="payout-list">
          {mine.data.map((m) => (
            <li key={m.id} className="row">
              <span>{nameOf(m.kind)} <span className="muted small">({t.countries[m.country]})</span>{m.isDefault && <span className="pill" style={{ marginInlineStart: 8 }}>{t.defaultTag}</span>}<br /><span className="ltr" style={{ display: 'inline-block' }}>{m.masked}</span></span>
              <button className="btn btn-ghost" onClick={async () => { await api('POST', `/me/payout-methods/${m.id}/remove`); mine.reload(); }}>{t.remove}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="stack-sm" onSubmit={add}>
        <div className="grid-2">
          <label>{t.country}
            <select value={country} onChange={(e) => { setCountry(e.target.value); setKind(''); }}>
              {['SA', 'EG', 'AE'].map((c) => <option key={c} value={c}>{t.countries[c]}</option>)}
            </select>
          </label>
          <label>{t.method}
            <select value={kind} onChange={(e) => setKind(e.target.value)} required>
              <option value="" disabled>—</option>
              {(dir.data?.methods ?? []).map((m: any) => <option key={m.kind} value={m.kind}>{m.name[lang]}</option>)}
            </select>
          </label>
        </div>
        <label>{t.value}<input className="ltr" value={value} onChange={(e) => setValue(e.target.value)} placeholder={spec?.hint[lang] ?? ''} required maxLength={64} /></label>
        <label className="check"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />{t.makeDefault}</label>
        <ErrorNote error={error} />
        <button className="btn btn-primary" disabled={!kind || value.trim().length < 3}>{t.addMethod}</button>
      </form>
    </section>
  );
}

/** Wathiq shell logo manager: add (file → data URL), rename, reorder, toggle, remove. Stored in this browser. */
function BusinessIdentity() {
  const { t } = useT();
  const [list, setList] = useState<OrgLogo[]>(readLogos);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const update = (next: OrgLogo[]) => { setList(next); saveLogos(next); };

  async function addLogo(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) || file.size > 300_000) { setError('PNG/JPEG/WEBP/SVG ≤ 300 KB'); return; }
    const src = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(file); });
    update([...list, { id: crypto.randomUUID(), name: name.trim() || file.name, src, show: true }]);
    setName('');
  }

  return (
    <section className="panel stack-sm">
      <h2>{t.identity}</h2>
      <p className="muted small">{t.identityExplain}</p>
      {list.length === 0 ? <EmptyState figure="hub" text={t.identity} /> : (
        <ul className="list">
          {list.map((l, i) => (
            <li key={l.id} className="row">
              <span className="row-start"><span className="logo-plate"><img src={l.src} alt="" /></span>
                <input aria-label={t.logoName} value={l.name} onChange={(e) => update(list.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))} style={{ width: 160 }} /></span>
              <span className="row-start">
                <label className="check small"><input type="checkbox" checked={l.show} onChange={(e) => update(list.map((x) => (x.id === l.id ? { ...x, show: e.target.checked } : x)))} />{t.showInHeader}</label>
                {i > 0 && <button className="btn btn-ghost" onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; update(n); }}>{t.up}</button>}
                <button className="btn btn-ghost" onClick={() => update(list.filter((x) => x.id !== l.id))}>{t.remove}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <label>{t.logoName}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
      <label>{t.logoFile}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => addLogo(e.target.files?.[0])} /></label>
      {error && <p className="notice error">{error}</p>}
    </section>
  );
}

/** Install on computer (Chrome/Edge: install icon or button) and phone (Android prompt, iPhone via Share). */
function AppOnDevices() {
  const { t } = useT();
  const { canInstall, installed, install } = useInstall();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <section className="panel stack-sm" data-testid="install-panel">
      <h2>{t.installTitle}</h2>
      <p className="muted small">{t.installExplain}</p>
      {installed ? <p className="notice ok">{t.installed}</p>
        : canInstall ? <button className="btn btn-primary" onClick={install}><Icon name="download" />{t.install}</button>
        : ios ? <p className="notice gold">{t.iosInstall}</p>
        : <p className="muted small">{t.installHint}</p>}
    </section>
  );
}
