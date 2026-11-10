import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isNative } from '../platform.ts';
import { api, googleSignIn, normalizePhone, requestCode, verifyCode, type SessionUser } from '../api.ts';
import { ErrorNote } from '../components.tsx';
import { useT } from '../i18n.ts';
import { WelcomeScene } from '../illustrations/Scenes.tsx';

declare global { interface Window { google?: any } }

/** Loads Google Identity Services only when a client id is configured, and renders its official button. */
function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (idToken: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { lang } = useT();
  useEffect(() => {
    const render = () => {
      if (!window.google || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onCredential(r.credential), ux_mode: 'popup' });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320, text: 'continue_with', locale: lang });
    };
    if (window.google) return render();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [clientId, lang]);
  return <div ref={ref} style={{ display: 'grid', placeItems: 'center', minHeight: 44 }} />;
}

export function Login({ onSignedIn, onIntro }: { onSignedIn: (u: SessionUser) => void; onIntro?: () => void }) {
  const { t } = useT();
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  // Google blocks sign-in inside embedded app web views, so the native apps use mobile OTP only.
  useEffect(() => { if (!isNative) api<any>('GET', '/config/public').then((c) => setGoogleClientId(c.googleClientId)).catch(() => {}); }, []);

  async function onGoogle(idToken: string) {
    setError(null);
    try {
      const r = await googleSignIn(idToken);
      if (r.needsPhone) { setLinkToken(r.linkToken!); if (r.suggestedName) setName(r.suggestedName); }
      else if (r.user) onSignedIn(r.user);
    } catch (e) { setError(e); }
  }

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
    try { onSignedIn(await verifyCode(phone!, code.trim(), name.trim(), linkToken ?? undefined)); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div className="narrow stack">
      <section className="stack-sm" style={{ textAlign: 'center', paddingTop: 8 }}>
        <WelcomeScene label={t.cele.welcomeArt} />
        <h1>{t.appName}</h1>
        <p className="muted">{t.tagline}</p>
        {onIntro && <button type="button" className="btn btn-ghost intro-link" onClick={onIntro}>{t.onb.label}</button>}
      </section>

      {linkToken && <p className="notice" role="status">{t.googleNeedsPhone}</p>}

      {!phone ? (
        <form className="panel stack" onSubmit={send} noValidate>
          <label>{t.phone}
            <input type="tel" className="ltr" inputMode="tel" autoComplete="tel" placeholder={t.phoneHint} value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} required aria-invalid={!!localError} />
          </label>
          {localError && <p className="notice error" role="alert">{localError}</p>}
          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy}>{t.sendCode}</button>
          {googleClientId && !linkToken && (
            <>
              <p className="muted small" style={{ textAlign: 'center' }}>{t.orDivider}</p>
              <GoogleButton clientId={googleClientId} onCredential={onGoogle} />
            </>
          )}
        </form>
      ) : (
        <form className="panel stack" onSubmit={verify}>
          <p className="muted small ltr" style={{ textAlign: 'start' }}>{phone}</p>
          {devCode && <p className="notice" data-testid="dev-code">{t.devCode(devCode)}</p>}
          <label>{t.code}
            <input className="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <label>{t.fullName}
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>{t.signIn}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setPhone(null); setCode(''); setDevCode(undefined); }}>{t.changePhone}</button>
        </form>
      )}
    </div>
  );
}
