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
import { TakeSeat } from './screens/Replace.tsx';
import { Circle } from './screens/Circle.tsx';
import { Account } from './screens/Account.tsx';
import { Admin } from './screens/Admin.tsx';
import { Goals } from './screens/Goals.tsx';
import { Onboarding, wasOnboarded } from './screens/Onboarding.tsx';

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
  useEffect(() => {
    const on = (e: Event) => setUser((u) => (u ? { ...u, fullName: (e as CustomEvent<string>).detail } : u));
    addEventListener('sg:name', on); return () => removeEventListener('sg:name', on);
  }, []);
  const [role, setRole] = useState<string>('NONE');
  const [onboarded, setOnboarded] = useState(wasOnboarded);
  const route = useHash();
  const t = dictionaries[lang];

  useEffect(() => { document.title = t.appName; }, [lang]);
  useEffect(() => {
    if (!user) return;
    api<any>('GET', '/auth/me').then((m) => setRole(m.platformRole)).catch(() => {});
  }, [user?.id]);

  const pendingJoin = route.startsWith('/join/') || route.startsWith('/seat/') ? route : null;
  const nav: NavItem[] = [
    { href: '#/', key: 'home', label: t.home, icon: 'home' },
    { href: '#/circles', key: 'circles', label: t.circles, icon: 'circles' },
    { href: '#/goals', key: 'goals', label: t.goals.title, icon: 'goals' },
    { href: '#/account', key: 'account', label: t.account, icon: 'account' },
    ...(role === 'PLATFORM_ADMIN' || role === 'COMPLIANCE_OFFICER' ? [{ href: '#/admin', key: 'admin', label: t.admin, icon: 'admin' }] : []),
  ];
  const path = route.split('?')[0];
  const query = route.split('?')[1] ?? '';
  const tab = path === '/' ? 'home' : path.startsWith('/c/') || path === '/circles' || path === '/new' || path.startsWith('/join') || path.startsWith('/seat/') ? 'circles'
    : path === '/advisor' ? 'goals' : path.slice(1).split('/')[0];

  let screen;
  if (!user && !onboarded) screen = <Onboarding onDone={() => setOnboarded(true)} />;
  else if (!user) screen = <Login onSignedIn={(u) => { setUser(u); if (pendingJoin) location.hash = pendingJoin; }} onIntro={() => setOnboarded(false)} />;
  else if (path === '/') screen = <Home user={user} />;
  else if (path === '/circles') screen = <Circles />;
  else if (path === '/new') screen = <CreateCircle key={query} query={query} />;
  else if (path.startsWith('/goals')) screen = <Goals tab={path.split('/')[2] ?? 'goals'} />;
  else if (route.startsWith('/join')) screen = <Join code={decodeURIComponent(route.split('/')[2] ?? '')} />;
  else if (route.startsWith('/seat/')) screen = <TakeSeat code={decodeURIComponent(route.split('/')[2] ?? '')} />;
  else if (route.startsWith('/c/')) screen = <Circle id={route.split('/')[2]} tab={route.split('/')[3] ?? 'overview'} />;
  else if (path === '/advisor') screen = <Goals tab="advisor" />;
  else if (path === '/account') screen = <Account />;
  else if (path === '/admin') screen = <Admin />;
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
