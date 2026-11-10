import { DrawStageHost } from './lottery/host.tsx';
import { flushSync } from 'react-dom';
import { Celebration } from './illustrations/Celebration.tsx';
import { useEffect, useState } from 'react';
import { api, currentUser, hasSession, logout, type SessionUser } from './api.ts';
import { I18n, dictionaries } from './i18n.ts';
import { Shell, type NavItem } from './shell/Shell.tsx';
import { useLang, useSkin } from './shell/prefs.ts';
import { Login } from './screens/Login.tsx';
import { Home } from './screens/Home.tsx';
import { Circles } from './screens/Circles.tsx';
import { CreateCircle } from './screens/CreateCircle.tsx';
import { Join } from './screens/Join.tsx';
import { Circle } from './screens/Circle.tsx';
import { Advisor } from './screens/Advisor.tsx';
import { Account } from './screens/Account.tsx';
import { Admin } from './screens/Admin.tsx';

function useHash() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => {
      const next = () => { flushSync(() => setHash(location.hash.slice(1) || '/')); window.scrollTo(0, 0); };
      // Short cross-fade between screens where the browser supports View Transitions; instant otherwise or with reduced motion.
      const d = document as any;
      if (d.startViewTransition && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        try {
          const vt = d.startViewTransition(next);
          // A skipped/aborted transition (background tab, slow update) must never surface as an error; the screen still changes.
          for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch?.(() => {});
        } catch { next(); }
      } else next();
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const [lang, setLang] = useLang();
  const [skin, setSkin] = useSkin();
  const [user, setUser] = useState<SessionUser | null>(() => (hasSession() ? currentUser() : null));
  const [role, setRole] = useState<string>('NONE');
  const route = useHash();
  const t = dictionaries[lang];

  useEffect(() => { document.title = t.appName; }, [lang]);
  useEffect(() => {
    if (!user) return;
    api<any>('GET', '/auth/me').then((m) => setRole(m.platformRole)).catch(() => {});
  }, [user?.id]);

  const pendingJoin = route.startsWith('/join/') ? route : null;
  const nav: NavItem[] = [
    { href: '#/', key: 'home', label: t.home, icon: 'home' },
    { href: '#/circles', key: 'circles', label: t.circles, icon: 'circles' },
    { href: '#/advisor', key: 'advisor', label: t.advisor, icon: 'advisor' },
    { href: '#/account', key: 'account', label: t.account, icon: 'account' },
    ...(role === 'PLATFORM_ADMIN' || role === 'COMPLIANCE_OFFICER' ? [{ href: '#/admin', key: 'admin', label: t.admin, icon: 'admin' }] : []),
  ];
  const tab = route === '/' ? 'home' : route.startsWith('/c/') || route === '/circles' || route === '/new' || route.startsWith('/join') ? 'circles'
    : route.slice(1).split('/')[0];

  let screen;
  if (!user) screen = <Login onSignedIn={(u) => { setUser(u); if (pendingJoin) location.hash = pendingJoin; }} />;
  else if (route === '/') screen = <Home user={user} />;
  else if (route === '/circles') screen = <Circles />;
  else if (route === '/new') screen = <CreateCircle />;
  else if (route.startsWith('/join')) screen = <Join code={decodeURIComponent(route.split('/')[2] ?? '')} />;
  else if (route.startsWith('/c/')) screen = <Circle id={route.split('/')[2]} tab={route.split('/')[3] ?? 'overview'} />;
  else if (route === '/advisor') screen = <Advisor />;
  else if (route === '/account') screen = <Account />;
  else if (route === '/admin') screen = <Admin />;
  else screen = <Home user={user} />;

  return (
    <I18n.Provider value={{ t, lang }}>
      <Shell nav={nav} current={tab} signedIn={!!user} userName={user?.fullName} skin={skin} setSkin={setSkin}
        toggleLang={() => setLang(lang === 'ar' ? 'en' : 'ar')}
        onSignOut={async () => { await logout(); setUser(null); setRole('NONE'); location.hash = '/'; }}>
        {screen}
      </Shell>
      <ImageViewer label={t.closeViewer} />
      <Celebration closeLabel={t.cele.close} />
      <DrawStageHost />
    </I18n.Provider>
  );
}

/** In-app receipt viewer (native apps open images here instead of a new browser tab). */
function ImageViewer({ label }: { label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setSrc((e as CustomEvent<string>).detail);
    addEventListener('sg:view-image', on);
    return () => removeEventListener('sg:view-image', on);
  }, []);
  if (!src) return null;
  const close = () => { URL.revokeObjectURL(src); setSrc(null); };
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={label} onClick={close}>
      <img src={src} alt="" />
      <button className="btn btn-secondary" onClick={close} autoFocus>{label}</button>
    </div>
  );
}
