import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isNative, platform } from '../platform.ts';
import { api, googleSignIn, normalizePhone, requestCode, verifyCode, type SessionUser } from '../api.ts';
import { ErrorNote } from '../components.tsx';
import { useT } from '../i18n.ts';
import { WelcomeSlider } from '../illustrations/WelcomeSlider.tsx';

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

/**
 * Native apps: Google's own sign-in sheet (Credential Manager on Android, Google Sign-In on iOS) via @capgo/capacitor-social-login.
 * The plugin is loaded only inside the apps, so the website bundle does not carry it.
 */
function NativeGoogleButton({ webClientId, iosClientId, onCredential, onError }: { webClientId: string; iosClientId: string | null; onCredential: (idToken: string) => void; onError: (e: unknown) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const usable = platform === 'android' || (platform === 'ios' && !!iosClientId);
  async function go() {
    setBusy(true);
    try {
      const { SocialLogin } = await import('@capgo/capacitor-social-login');
      await SocialLogin.initialize({ google: platform === 'ios'
        ? { iOSClientId: iosClientId!, iOSServerClientId: webClientId, mode: 'online' }
        : { webClientId, mode: 'online', skipAuthOnlyAuthorizationAfterSignIn: true } } as any);
      const r: any = await SocialLogin.login({ provider: 'google', options: platform === 'ios' ? { scopes: ['email', 'profile'] } : {} } as any);
      const idToken = r?.result?.idToken;
      if (!idToken) throw new Error('no id token');
      onCredential(idToken);
    } catch (e: any) {
      if (!/cancel/i.test(String(e?.message ?? e))) onError(e);
    } finally { setBusy(false); }
  }
  if (!usable) return <p className="notice" role="status">{t.gsign.native}</p>;
  return (
    <button type="button" className="btn btn-secondary btn-block google-native" onClick={go} disabled={busy} data-testid="google-native">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.8 0-5.3-1.9-6.1-4.5H2.3v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.9 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.3a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.1l3.6 2.8C6.7 7.3 9.2 5.4 12 5.4z"/></svg>
      <span>{t.gsign.button}</span>
    </button>
  );
}

export function Login({ onSignedIn, onIntro }: { onSignedIn: (u: SessionUser) => void; onIntro?: () => void }) {
  const { t } = useT();
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleIosClientId, setGoogleIosClientId] = useState<string | null>(null);
  const [phoneSignIn, setPhoneSignIn] = useState<boolean | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  // Google blocks its web button inside app web views, so the native apps use Google's native sign-in instead.
  useEffect(() => {
    api<any>('GET', '/config/public').then((c) => { setGoogleClientId(c.googleClientId); setGoogleIosClientId(c.googleIosClientId ?? null); setPhoneSignIn(c.phoneSignIn !== false); })
      .catch(() => setPhoneSignIn(true));
  }, []);

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
        <WelcomeSlider />
        <h1>{t.appName}</h1>
        <p className="muted">{t.tagline}</p>
        {onIntro && <button type="button" className="btn btn-ghost intro-link" onClick={onIntro}>{t.onb.label}</button>}
      </section>

      {linkToken && <p className="notice" role="status">{t.googleNeedsPhone}</p>}

      {phoneSignIn === false ? (
        <section className="panel stack" data-testid="google-only">
          <h2>{t.gsign.title}</h2>
          <p className="muted small">{t.gsign.body}</p>
          <ErrorNote error={error} />
          {!googleClientId ? <p className="notice" role="status">{t.gsign.notConfigured}</p>
            : isNative ? <NativeGoogleButton webClientId={googleClientId} iosClientId={googleIosClientId} onCredential={onGoogle} onError={setError} />
            : <GoogleButton clientId={googleClientId} onCredential={onGoogle} />}
        </section>
      ) : !phone ? (
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
              {isNative ? <NativeGoogleButton webClientId={googleClientId} iosClientId={googleIosClientId} onCredential={onGoogle} onError={setError} />
                : <GoogleButton clientId={googleClientId} onCredential={onGoogle} />}
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
