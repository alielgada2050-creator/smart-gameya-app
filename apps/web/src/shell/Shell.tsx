import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { useT, time } from '../i18n.ts';
import { Icon } from './icons.tsx';
import { useLogos, type Skin } from './prefs.ts';

export interface NavItem { href: string; key: string; label: string; icon: string }

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('mousedown', on); addEventListener('touchstart', on); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', on); removeEventListener('touchstart', on); removeEventListener('keydown', esc); };
  }, [open]);
  return ref;
}

/** Install as an app on desktop (Chrome/Edge) and Android; iOS uses Share → Add to Home Screen. */
export function useInstall() {
  const [prompt, setPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(() => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    return () => { removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', onInstalled); };
  }, []);
  const install = async () => { if (!prompt) return; prompt.prompt(); await prompt.userChoice.catch(() => null); setPrompt(null); };
  return { canInstall: !!prompt && !installed, installed, install };
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  return online;
}

function Logos() {
  const logos = useLogos().filter((l) => l.show);
  const { t } = useT();
  if (!logos.length) return null;
  return <div className="logo-strip" aria-label={t.identity}>{logos.map((l) => <span key={l.id} className="logo-plate" title={l.name}><img src={l.src} alt={l.name} /></span>)}</div>;
}

export function Shell({ nav, current, signedIn, userName, skin, setSkin, toggleLang, onSignOut, children }: {
  nav: NavItem[]; current: string; signedIn: boolean; userName?: string; skin: Skin; setSkin: (s: Skin) => void; toggleLang: () => void; onSignOut: () => void; children: ReactNode;
}) {
  const { t, lang } = useT();
  const online = useOnline();
  const { canInstall, install } = useInstall();
  const [open, setOpen] = useState<'' | 'skin' | 'bell' | 'account'>('');
  const close = () => setOpen('');
  const skinRef = useOutside(open === 'skin', close);
  const bellRef = useOutside(open === 'bell', close);
  const accRef = useOutside(open === 'account', close);
  const [notes, setNotes] = useState<{ unread: number; items: any[] }>({ unread: 0, items: [] });
  const currentLabel = nav.find((n) => n.key === current)?.label ?? '';

  useEffect(() => {
    if (!signedIn) return;
    const load = () => api('GET', '/me/notifications').then(setNotes).catch(() => {});
    load();
    addEventListener('sg:resume', load);
    const h = setInterval(load, 60_000);
    return () => { clearInterval(h); removeEventListener('sg:resume', load); };
  }, [signedIn, current]);

  const brand = <a className="brand" href="#/"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />{t.appName}</a>;
  const links = (cls?: string) => nav.map((n) => (
    <a key={n.key} href={n.href} className={cls} aria-current={current === n.key ? 'page' : undefined}>
      <span className="pip"><Icon name={n.icon} /></span><span>{n.label}</span>
    </a>
  ));

  return (
    <div className={signedIn ? 'app' : 'app signed-out'}>
      {signedIn && (
        <aside className="sidebar">
          {brand}
          <nav aria-label={t.appName}>{links()}</nav>
          <div className="side-foot"><Logos /></div>
        </aside>
      )}
      <div>
        <header className="topbar">
          <div className="topbar-inner">
            {brand}
            <Logos />
            {signedIn && <span className="page-title desktop-only" aria-hidden="true">{currentLabel}</span>}
            <div className="actions">
              {canInstall && (
                <button className="icon-btn install-btn" onClick={install} aria-label={t.install}><Icon name="download" /><span className="install-label">{t.install}</span></button>
              )}
              {signedIn && (
                <div ref={bellRef} style={{ position: 'relative' }}>
                  <button className="icon-btn" aria-label={`${t.notifications} (${notes.unread})`} aria-expanded={open === 'bell'} onClick={() => setOpen(open === 'bell' ? '' : 'bell')}>
                    <Icon name="bell" />{notes.unread > 0 && <span className="badge" data-testid="unread">{notes.unread > 9 ? '9+' : notes.unread}</span>}
                  </button>
                  {open === 'bell' && (
                    <div className="menu sheet-like" role="dialog" aria-label={t.notifications} style={{ width: 'min(92vw, 360px)', maxHeight: 440, overflow: 'auto' }}>
                      {notes.items.length === 0 ? <p className="muted small" style={{ padding: 10 }}>{t.noNotifications}</p> : (
                        <>
                          {notes.items.slice(0, 15).map((n) => (
                            <a key={n.id} href={n.gamiyaId ? `#/c/${n.gamiyaId}` : '#/'} onClick={close} style={{ display: 'grid', gap: 2, padding: '8px 10px', fontWeight: n.read ? 400 : 600 }}>
                              <span>{n.body}</span>
                              <span className="muted small" style={{ fontWeight: 400 }}>{n.gamiyaName ? `${n.gamiyaName}${t.sep}` : ''}{time(n.at, lang)}</span>
                            </a>
                          ))}
                          <hr />
                          <button onClick={async () => { await api('POST', '/me/notifications/read'); setNotes({ ...notes, unread: 0, items: notes.items.map((i) => ({ ...i, read: true })) }); }}>{t.markRead}</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button className="icon-btn lang-btn" onClick={toggleLang} lang={lang === 'ar' ? 'en' : 'ar'} aria-label={t.language} title={t.language}><Icon name="globe" /><span className="lang-label" aria-hidden="true">{lang === 'ar' ? 'EN' : 'ع'}</span></button>
              <div ref={skinRef} style={{ position: 'relative' }}>
                <button className="icon-btn" aria-label={`${t.appearance}: ${t.skins[skin]}`} aria-haspopup="menu" aria-expanded={open === 'skin'} onClick={() => setOpen(open === 'skin' ? '' : 'skin')}><Icon name="skin" /></button>
                {open === 'skin' && (
                  <div className="menu" role="menu" aria-label={t.appearance}>
                    {(['auto', 'light', 'dark', 'comfort', 'bright'] as Skin[]).map((s) => (
                      <button key={s} role="menuitemradio" aria-checked={skin === s} onClick={() => { setSkin(s); close(); }}>{t.skins[s]}</button>
                    ))}
                  </div>
                )}
              </div>
              {signedIn && (
                <div ref={accRef} style={{ position: 'relative' }}>
                  <button className="icon-btn" aria-label={t.account} aria-haspopup="menu" aria-expanded={open === 'account'} onClick={() => setOpen(open === 'account' ? '' : 'account')}><Icon name="account" /></button>
                  {open === 'account' && (
                    <div className="menu" role="menu">
                      <p className="small" style={{ padding: '6px 10px', fontWeight: 600 }}>{userName}</p>
                      <a role="menuitem" href="#/account" onClick={close}>{t.accountTitle}</a>
                      <hr />
                      <button role="menuitem" onClick={() => { close(); onSignOut(); }}>{t.signOut}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {!online && <p className="offline" role="status">{t.offline}</p>}
        </header>
        <main className="page">{children}</main>
      </div>
      {signedIn && <nav className="bottom-nav" aria-label={t.appName}>{links()}</nav>}
    </div>
  );
}
