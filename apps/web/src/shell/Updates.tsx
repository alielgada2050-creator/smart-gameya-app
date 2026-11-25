/**
 * Keeps people on the latest version.
 * Website / installed web app: polls /version.json (every 10 minutes and whenever the app comes back to the screen);
 * when a newer build is live it offers «حدّث الآن», which reloads into it (the service worker fetches pages network-first).
 * Android / iOS apps: the server reports its release; when it is newer than the app's own, it points to the store.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useT } from '../i18n.ts';
import { isNative, platform } from '../platform.ts';

const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

export function UpdateBanner() {
  const { t } = useT();
  const [kind, setKind] = useState<'web' | 'store' | null>(null);
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (import.meta.env.MODE === 'demo' || !import.meta.env.PROD) return;
    if (isNative) {
      api<any>('GET', '/config/public').then((c) => { if (c.version && newer(c.version, __APP_VERSION__)) { setKind('store'); setStoreUrl(c.stores?.[platform] ?? null); } }).catch(() => {});
      return;
    }
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch('/version.json', { cache: 'no-store' });
        if (!r.ok) return;
        const v = await r.json();
        if (!stop && v.build && v.build !== __BUILD_ID__) setKind('web');
      } catch { /* offline: try again later */ }
    };
    const onShow = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = setInterval(check, 10 * 60_000);
    document.addEventListener('visibilitychange', onShow);
    void check();
    return () => { stop = true; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, []);

  if (!kind || hidden) return null;
  const reload = async () => {
    try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* reload anyway */ }
    location.reload();
  };
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <span>{kind === 'web' ? t.updates.web : t.updates.store}</span>
      {kind === 'web' ? <button className="btn btn-primary btn-xs" onClick={reload}>{t.updates.now}</button>
        : storeUrl && <a className="btn btn-primary btn-xs" target="_blank" rel="noopener" href={storeUrl}>{t.updates.store_btn}</a>}
      <button className="btn btn-ghost btn-xs" onClick={() => setHidden(true)}>{t.updates.later}</button>
    </div>
  );
}
