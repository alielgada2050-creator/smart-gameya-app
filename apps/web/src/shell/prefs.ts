import { useEffect, useState } from 'react';
import { syncStatusBar } from '../platform.ts';

/** Wathiq shell preferences: skin and language live on <html> and are broadcast with wq:* events. */
export type Skin = 'auto' | 'light' | 'dark' | 'bright';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export function applySkin(skin: Skin) {
  if (skin === 'auto') document.documentElement.removeAttribute('data-skin');
  else document.documentElement.setAttribute('data-skin', skin);
  write('wq.skin', skin);
}

export function useSkin(): [Skin, (s: Skin) => void] {
  const [skin, setSkin] = useState<Skin>(() => (read('wq.skin') as Skin) || 'auto');
  useEffect(() => { applySkin(skin); dispatchEvent(new CustomEvent('wq:skin', { detail: skin })); void syncStatusBar(); }, [skin]);
  return [skin, setSkin];
}

export function useLang(): ['ar' | 'en', (l: 'ar' | 'en') => void] {
  const [lang, setLang] = useState<'ar' | 'en'>(() => ((read('wq.lang') ?? read('sg.lang')) === 'en' ? 'en' : 'ar'));
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    write('wq.lang', lang);
    dispatchEvent(new CustomEvent('wq:lang', { detail: lang }));
  }, [lang]);
  return [lang, setLang];
}

/** Business identity: organisation logos shown on a neutral plate in the header (localStorage wq.orgLogos). */
export interface OrgLogo { id: string; name: string; src: string; show: boolean }
export function readLogos(): OrgLogo[] {
  try { return JSON.parse(read('wq.orgLogos') ?? '[]'); } catch { return []; }
}
export function saveLogos(list: OrgLogo[]) {
  write('wq.orgLogos', JSON.stringify(list));
  dispatchEvent(new CustomEvent('wq:logos'));
}
export function useLogos(): OrgLogo[] {
  const [list, setList] = useState(readLogos);
  useEffect(() => {
    const on = () => setList(readLogos());
    addEventListener('wq:logos', on);
    return () => removeEventListener('wq:logos', on);
  }, []);
  return list;
}
