import { useEffect, useState } from 'react';
import { currentUser, hasSession, logout, type SessionUser } from './api.ts';
import { I18n, dictionaries, type Lang } from './i18n.ts';
import { Login } from './screens/Login.tsx';
import { Home } from './screens/Home.tsx';
import { Circles } from './screens/Circles.tsx';
import { CreateCircle } from './screens/CreateCircle.tsx';
import { Join } from './screens/Join.tsx';
import { Circle } from './screens/Circle.tsx';
import { Advisor } from './screens/Advisor.tsx';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function useHash() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => { setHash(location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => (read('sg.lang') === 'en' ? 'en' : 'ar'));
  const [theme, setTheme] = useState<string>(() => read('sg.theme') ?? 'system');
  const [user, setUser] = useState<SessionUser | null>(() => (hasSession() ? currentUser() : null));
  const route = useHash();
  const t = dictionaries[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t.appName;
    write('sg.lang', lang);
  }, [lang]);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    write('sg.theme', theme);
  }, [theme]);

  const nextTheme = () => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system');
  const themeIcon = theme === 'dark'
    ? <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor" />
    : theme === 'light'
      ? <g stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></g>
      : <g><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" /></g>;

  const toolbar = (
    <div className="toolbar">
      <button className="btn-ghost" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} lang={lang === 'ar' ? 'en' : 'ar'}>{t.language}</button>
      <button className="btn-ghost" onClick={nextTheme} aria-label={`${t.theme}: ${t.themeNames[theme]}`} title={`${t.theme}: ${t.themeNames[theme]}`}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{themeIcon}</svg></button>
      {user && <button className="btn-ghost" onClick={async () => { await logout(); setUser(null); location.hash = '/'; }}>{t.signOut}</button>}
    </div>
  );

  // Keep an invite link working through sign-in.
  const pendingJoin = route.startsWith('/join/') ? route : null;

  let screen;
  if (!user) screen = <Login onSignedIn={(u) => { setUser(u); if (pendingJoin) location.hash = pendingJoin; }} />;
  else if (route === '/' ) screen = <Home user={user} />;
  else if (route === '/circles') screen = <Circles />;
  else if (route === '/new') screen = <CreateCircle />;
  else if (route.startsWith('/join')) screen = <Join code={decodeURIComponent(route.split('/')[2] ?? '')} />;
  else if (route.startsWith('/c/')) screen = <Circle id={route.split('/')[2]} user={user} />;
  else if (route === '/advisor') screen = <Advisor />;
  else screen = <Home user={user} />;

  const tab = route === '/' ? 'home' : route === '/advisor' ? 'advisor' : route.startsWith('/c/') || route === '/circles' || route === '/new' || route.startsWith('/join') ? 'circles' : '';

  return (
    <I18n.Provider value={{ t, lang }}>
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="#/" style={{ color: 'inherit', textDecoration: 'none' }}><img src="/icon.svg" alt="" />{t.appName}</a>
          {toolbar}
        </header>
        <main>{screen}</main>
      </div>
      {user && (
        <nav className="tabbar" aria-label={t.appName}>
          <a href="#/" aria-current={tab === 'home' ? 'page' : undefined}>{t.home}</a>
          <a href="#/circles" aria-current={tab === 'circles' ? 'page' : undefined}>{t.circles}</a>
          <a href="#/advisor" aria-current={tab === 'advisor' ? 'page' : undefined}>{t.advisor}</a>
        </nav>
      )}
    </I18n.Provider>
  );
}
