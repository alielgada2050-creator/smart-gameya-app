/**
 * One codebase, three targets: browser (PWA), Android and iOS (Capacitor, phones and tablets).
 *
 * In the browser the app and the API share one origin, so API paths stay relative.
 * In the native apps the UI is bundled on the device (https://localhost on Android, capacitor://localhost on iOS),
 * so every API call goes to VITE_API_ORIGIN (e.g. https://app.example.sa), which must list those origins in CORS_ORIGINS.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as 'web' | 'android' | 'ios';

const configured = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? '';
/** Base for API calls: '' in the browser (same origin), the server origin in the apps. */
export const API_ORIGIN = isNative ? configured : '';
/** Public web address for links people share (invites). In the apps this is the server, not the on-device origin. */
export const WEB_ORIGIN = isNative ? configured : location.origin;

/** Native-only setup: status bar colour per skin, splash, Android back button. Lazy imports keep the web bundle lean. */
export async function initNative() {
  if (!isNative) return;
  const [{ App }, { SplashScreen }] = await Promise.all([import('@capacitor/app'), import('@capacitor/splash-screen')]);
  document.documentElement.dataset.native = platform;
  App.addListener('backButton', ({ canGoBack }) => {
    // Close an open menu or sheet first, then go back through the hash routes, then leave the app.
    const open = document.querySelector('[aria-expanded="true"]') as HTMLElement | null;
    if (open) { open.click(); return; }
    if (canGoBack && location.hash && location.hash !== '#/') history.back(); else App.exitApp();
  });
  // Re-check the session and data when the app returns to the foreground.
  App.addListener('resume', () => dispatchEvent(new Event('sg:resume')));
  await syncStatusBar();
  await SplashScreen.hide();
}

/** Match the system status bar to the active skin (light text on dark skins). */
export async function syncStatusBar() {
  if (!isNative) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#FFFFFF';
  const dark = isDarkColor(bg);
  await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  if (platform === 'android') await StatusBar.setBackgroundColor({ color: toHex(bg) }).catch(() => {});
}

/** Share sheet in the apps; clipboard in the browser. Returns true when the native sheet was used. */
export async function shareLink(title: string, url: string): Promise<boolean> {
  if (isNative) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, text: title, url, dialogTitle: title }).catch(() => {});
    return true;
  }
  if (navigator.share) { await navigator.share({ title, url }).catch(() => {}); return true; }
  return false;
}

/** Light haptic tick on important confirmations (apps only). */
export async function tick() {
  if (!isNative) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

/**
 * Open a protected file (receipt / note) that was downloaded with the bearer token.
 * Browser: new tab via blob URL. Apps: images open in the in-app viewer; PDFs are written to the app cache and handed
 * to the system share sheet so the user can open them in a PDF viewer. Nothing is written outside the app sandbox.
 */
export async function presentFile(blob: Blob, name: string) {
  // The demo runs inside an embedded page where new tabs may be blocked: images open in the in-app viewer there too.
  const inAppViewer = isNative || (import.meta.env.MODE === 'demo' && blob.type.startsWith('image/'));
  if (!inAppViewer) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  if (blob.type.startsWith('image/')) {
    dispatchEvent(new CustomEvent('sg:view-image', { detail: URL.createObjectURL(blob) }));
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const data = await blobToBase64(blob);
  const res = await Filesystem.writeFile({ path: `files/${name}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ url: res.uri, dialogTitle: name }).catch(() => {});
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = fail; r.readAsDataURL(blob); });
}
function toHex(c: string) {
  if (c.startsWith('#')) return c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c;
  const m = c.match(/\d+/g); return m ? `#${m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : '#FFFFFF';
}
function isDarkColor(c: string) {
  const h = toHex(c); const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}
