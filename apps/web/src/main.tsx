import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
// Fonts ship with the app (no Google Fonts request): works offline in the phone/tablet apps and keeps the CSP first-party.
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import './styles.css';
import { initNative, isNative } from './platform.ts';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Installable app on desktop and phones. Production builds only, so development never serves a stale shell.
// The Android/iOS apps bundle their files on the device, so they need no service worker.
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
}

void initNative();
