import { useState, type FormEvent } from 'react';
import { normalizePhone, requestCode, verifyCode, type SessionUser } from '../api.ts';
import { ErrorNote, Ring } from '../components.tsx';
import { useT } from '../i18n.ts';

export function Login({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const { t } = useT();
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null); setLocalError('');
    const p = normalizePhone(phoneInput);
    if (!p) return setLocalError(t.invalidPhone);
    setBusy(true);
    try { const r = await requestCode(p); setPhone(p); setDevCode(r.devCode); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try { onSignedIn(await verifyCode(phone!, code.trim(), name.trim())); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <section className="login-hero">
        <Ring total={8} members={Array.from({ length: 8 }, (_, i) => ({ label: '', position: i + 1 }))} currentPosition={3} completedThrough={2} />
        <h1>{t.appName}</h1>
        <p className="muted">{t.tagline}</p>
      </section>

      {!phone ? (
        <form className="panel stack" onSubmit={send} noValidate>
          <label>{t.phone}
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder={t.phoneHint} value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} required aria-invalid={!!localError} />
          </label>
          {localError && <p className="notice error" role="alert">{localError}</p>}
          <ErrorNote error={error} />
          <button className="btn-primary btn-block" disabled={busy}>{t.sendCode}</button>
        </form>
      ) : (
        <form className="panel stack" onSubmit={verify}>
          <p className="muted small" dir="ltr" style={{ textAlign: 'start' }}>{phone}</p>
          {devCode && <p className="notice" data-testid="dev-code">{t.devCode(devCode)}</p>}
          <label>{t.code}
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <label>{t.fullName}
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
          <ErrorNote error={error} />
          <button className="btn-primary btn-block" disabled={busy || code.length !== 6}>{t.signIn}</button>
          <button type="button" className="btn-ghost" onClick={() => { setPhone(null); setCode(''); setDevCode(undefined); }}>{t.changePhone}</button>
        </form>
      )}
    </div>
  );
}
