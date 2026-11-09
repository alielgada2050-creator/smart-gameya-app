import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { useT, time } from '../i18n.ts';
import { Icon } from './icons.tsx';
import { useLogos, type Skin } from './prefs.ts';

export interface NavItem { href: string; key: string; label: string; icon: string }

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('mousedown', on); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', on); removeEventListener('keydown', esc); };
  }, [open]);
  return ref;
}

export function Header({ nav, current, signedIn, userName, skin, setSkin, toggleLang, onSignOut }: {
  nav: NavItem[]; current: string; signedIn: boolean; userName?: string; skin: Skin; setSkin: (s: Skin) => void; toggleLang: () => void; onSignOut: () => void;
}) {
  const { t, lang } = useT();
  const logos = useLogos().filter((l) => l.show);
  const [open, setOpen] = useState<'' | 'skin' | 'bell' | 'account' | 'sheet'>('');
  const close = () => setOpen('');
  const skinRef = useOutside(open === 'skin', close);
  const bellRef = useOutside(open === 'bell', close);
  const accRef = useOutside(open === 'account', close);
  const [notes, setNotes] = useState<{ unread: number; items: any[] }>({ unread: 0, items: [] });

  useEffect(() => {
    if (!signedIn) return;
    const load = () => api('GET', '/me/notifications').then(setNotes).catch(() => {});
    load();
    const h = setInterval(load, 60_000);
    return () => clearInterval(h);
  }, [signedIn, current]);

  return (
    <header className="header">
      <div className="header-top">
        {signedIn && (
          <button className="icon-btn menu-btn" aria-label={t.menu} aria-expanded={open === 'sheet'} onClick={() => setOpen('sheet')}><Icon name="menu" /></button>
        )}
        <a className="brand" href="#/"><img src="/icon.svg" alt="" /><span>{t.appName}</span></a>
        <div className="logo-strip" aria-label={t.identity}>
          {logos.map((l) => <span key={l.id} className="logo-plate" title={l.name}><img src={l.src} alt={l.name} /></span>)}
        </div>
        <div className="actions">
          {signedIn && (
            <div ref={bellRef} style={{ position: 'relative' }}>
              <button className="icon-btn" aria-label={`${t.notifications} (${notes.unread})`} aria-expanded={open === 'bell'} onClick={() => setOpen(open === 'bell' ? '' : 'bell')}>
                <Icon name="bell" />{notes.unread > 0 && <span className="badge" data-testid="unread">{notes.unread > 9 ? '9+' : notes.unread}</span>}
              </button>
              {open === 'bell' && (
                <div className="menu" role="dialog" aria-label={t.notifications} style={{ width: 'min(86vw, 340px)', maxHeight: 420, overflow: 'auto' }}>
                  {notes.items.length === 0 ? <p className="muted small" style={{ padding: 10 }}>{t.noNotifications}</p> : (
                    <>
                      {notes.items.slice(0, 15).map((n) => (
                        <a key={n.id} href={n.gamiyaId ? `#/c/${n.gamiyaId}` : '#/'} onClick={close} style={{ display: 'grid', gap: 2, fontWeight: n.read ? 400 : 600 }}>
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
          <button className="icon-btn" onClick={toggleLang} lang={lang === 'ar' ? 'en' : 'ar'} aria-label={t.language} title={t.language}><Icon name="globe" /></button>
          <div ref={skinRef} style={{ position: 'relative' }}>
            <button className="icon-btn" aria-label={`${t.appearance}: ${t.skins[skin]}`} aria-haspopup="menu" aria-expanded={open === 'skin'} onClick={() => setOpen(open === 'skin' ? '' : 'skin')}><Icon name="skin" /></button>
            {open === 'skin' && (
              <div className="menu" role="menu" aria-label={t.appearance}>
                {(['auto', 'light', 'dark', 'bright'] as Skin[]).map((s) => (
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
      {signedIn && (
        <nav className="header-nav" aria-label={t.appName}>
          {nav.map((n) => <a key={n.key} href={n.href} aria-current={current === n.key ? 'page' : undefined}><Icon name={n.icon} />{n.label}</a>)}
        </nav>
      )}
      {open === 'sheet' && (
        <>
          <div className="scrim" onClick={close} />
          <nav className="sheet" aria-label={t.menu}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="brand"><img src="/icon.svg" alt="" />{t.appName}</span>
              <button className="icon-btn" aria-label={t.cancel} onClick={close}><Icon name="close" /></button>
            </div>
            {nav.map((n) => <a key={n.key} href={n.href} onClick={close} aria-current={current === n.key ? 'page' : undefined}><Icon name={n.icon} />{n.label}</a>)}
          </nav>
        </>
      )}
    </header>
  );
}
