/**
 * Demo bootstrap (demo build only): Node's Buffer for the real lottery code, an in-page API behind fetch(),
 * and a small persona switcher so one person can play every role (organizer, payer, recipient, platform reviewer).
 */
import { Buffer } from 'buffer';
(globalThis as any).Buffer ??= Buffer;

const PERSONAS: { phone: string; role: string }[] = [
  { phone: '+966551110001', role: 'منظِّمة «الأصدقاء» و«العائلة» — إيصالات بانتظارها' },
  { phone: '+966551110002', role: 'عضو، ومنظِّم «الجمعية الكبيرة»' },
  { phone: '+966551110003', role: 'عضوة — على تحويلها اعتراض مفتوح' },
  { phone: '+966551110004', role: 'عضو — حوّل مبلغاً ناقصاً' },
  { phone: '+966551110009', role: 'مراجِعة المنصة — اعتراض وجمعية كبيرة' },
];
const TRY = [
  'سارة: من «المدفوعات» اعتمد إيصال خالد، وراجع «المطابقة التلقائية» لقسط فهد قبل التأكيد.',
  'سارة: في «جمعية العائلة» اختر «بالأولوية» ← «اقتراح المساعد الذكي» ← اقترح الترتيب، ثم بدّل إلى خالد ونورة للتصويت.',
  'أو جرّب القرعة: جهّزها كسارة، وافق كخالد، ثم نفّذها كسارة.',
  'خالد أو نورة: انضم إلى «جمعية الحي» برمز الدعوة HAYY2026، وسارة أو فهد إلى «جمعية الجمعة» برمز JUMAA26: راجع الشروط ووقّع إقرار السداد.',
  'سارة: في الرئيسية «دعوة لك» من نورة إلى «جمعية الجمعة». ومن أي جمعية تنظمها جرّب «ادعُ مباشرة» واختر الكل.',
  'سارة: عدّل مبلغ «جمعية الحي» من «عدّل الجمعية»، ثم بدّل إلى فهد ليوافق على الشروط الجديدة أو ينسحب.',
  'ريم: من «الإدارة» احسم اعتراض نورة واعتمد «الجمعية الكبيرة».',
  'أي عضو: اكتب «@مساعد تقرير» في محادثة الجمعية، وجرّب «أهدافي» ← «المخطط الذكي».',
];

export async function install() {
  const server = await import('./server.ts');
  server.load();
  const realFetch = window.fetch.bind(window);
  const wait = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180)); // feel of a network round-trip
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    const at = url.pathname.indexOf('/api/v1/');
    if (at < 0) return realFetch(input as RequestInfo, init);
    const path = url.pathname.slice(at + 7);
    const method = (init?.method ?? 'GET').toUpperCase();
    const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    const me = token?.startsWith('demo-at.') ? token.slice(8) : '';
    await wait();
    try {
      const file = /^\/files\/([^/]+)$/.exec(path);
      if (method === 'GET' && file) {
        const blob = server.fileBlob(file[1], me);
        return new Response(blob, { status: 200, headers: { 'content-type': blob.type } });
      }
      const up = /^\/gamiyas\/([^/]+)\/files$/.exec(path);
      if (method === 'POST' && up) {
        if (!me) return json(401, { error: { code: 'UNAUTHORIZED', message: 'sign in' } });
        const fd = init?.body as FormData;
        return json(201, await server.upload(up[1], me, String(fd.get('purpose')), fd.get('file') as File));
      }
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const r = await server.handle(method, path, url.searchParams, body, token);
      return json(r.status, r.data);
    } catch (e) {
      const err = e as { status?: number; code?: string; message: string };
      return json(err.status ?? 500, { error: { code: err.code ?? 'DEMO_ERROR', message: err.message } });
    }
  };

  mountSwitcher(server);
  followHostTheme();
}

/** Inside the artifact viewer the host sets data-theme; with the app's skin on "auto", follow it. */
function followHostTheme() {
  const root = document.documentElement;
  const sync = () => {
    let chosen: string | null = null;
    try { chosen = localStorage.getItem('wq.skin'); } catch { /* ignore */ }
    if (chosen && chosen !== 'auto') return;
    const host = root.getAttribute('data-theme');
    const want = host === 'dark' || host === 'light' ? host : null;
    if (want && root.getAttribute('data-skin') !== want) root.setAttribute('data-skin', want);
  };
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-skin'] });
  sync();
}

function signInAs(server: typeof import('./server.ts'), userId: string) {
  const t = server.tokens(userId);
  try {
    localStorage.setItem('sg.refresh', t.refreshToken);
    localStorage.setItem('sg.user', JSON.stringify(t.user));
  } catch { /* storage blocked: the login form still works */ }
  location.hash = '/';
  location.reload();
}

function mountSwitcher(server: typeof import('./server.ts')) {
  let current: { id: string; fullName: string } | null = null;
  try { current = JSON.parse(localStorage.getItem('sg.user') ?? 'null'); } catch { /* ignore */ }
  const style = document.createElement('style');
  style.textContent = `
  .demo-pill{position:fixed;z-index:55;inset-inline-end:12px;bottom:calc(var(--bottombar-h,64px) + env(safe-area-inset-bottom) + 12px);min-height:44px;padding:0 14px;border-radius:999px;opacity:.94;
    border:1px solid var(--line);background:var(--ink);color:var(--bg);font:600 13px/1 var(--font);display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgba(15,23,42,.25);cursor:pointer}
  .demo-pill i{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block}
  @media (min-width:1024px){.demo-pill{bottom:16px}}
  .demo-panel{position:fixed;z-index:70;inset:auto 12px calc(var(--bottombar-h,64px) + env(safe-area-inset-bottom) + 64px) 12px;max-width:420px;max-height:min(78vh,640px);overflow:auto;
    margin-inline-start:0;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 48px rgba(15,23,42,.28);padding:16px;font-family:var(--font)}
  @media (min-width:1024px){.demo-panel{inset:auto auto 72px auto;inset-inline-end:16px;width:420px}}
  .demo-panel h2{margin:0 0 4px;font-size:1.05rem}.demo-panel p{margin:0 0 10px;color:var(--muted);font-size:.85rem;line-height:1.6}
  .demo-panel ul{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}
  .demo-panel li button{width:100%;min-height:52px;display:grid;gap:2px;text-align:start;padding:8px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer;font:inherit}
  .demo-panel li button[aria-current=true]{border-color:var(--accent);background:var(--accent-tint)}
  .demo-panel li b{font-size:.95rem}.demo-panel li span{font-size:.8rem;color:var(--muted)}
  .demo-panel ol{margin:0 0 12px;padding-inline-start:18px;display:grid;gap:6px;font-size:.85rem;line-height:1.6}
  .demo-row{display:flex;gap:8px;flex-wrap:wrap}.demo-row button{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--control-line);background:var(--surface);color:var(--ink);font:600 .85rem var(--font);cursor:pointer}
  @media (prefers-reduced-motion:no-preference){.demo-panel{animation:demo-in 240ms cubic-bezier(.16,1,.3,1)}@keyframes demo-in{from{opacity:0;transform:translateY(12px)}}}`;
  document.head.appendChild(style);

  const pill = document.createElement('button');
  pill.className = 'demo-pill'; pill.type = 'button'; pill.setAttribute('aria-expanded', 'false'); pill.setAttribute('data-testid', 'demo-switcher');
  pill.innerHTML = `<i aria-hidden="true"></i><span>تجربة · ${current ? escapeHtml(current.fullName) : 'اختر عضواً'}</span>`;
  const panel = document.createElement('section');
  panel.className = 'demo-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'نسخة تجريبية');
  const people = server.users().filter((u) => PERSONAS.some((p) => p.phone === u.phone));
  panel.innerHTML = `
    <h2>نسخة تجريبية من «جمعيتي»</h2>
    <p>كل البيانات وهمية وتبقى في متصفحك فقط، ولا تُحوَّل أي أموال. بدّل بين الأعضاء لتجرّب كل دور في الرحلة نفسها.</p>
    <ul>${people.map((u) => `<li><button type="button" data-user="${u.id}" aria-current="${current?.id === u.id}"><b>${escapeHtml(u.fullName)}</b><span>${PERSONAS.find((p) => p.phone === u.phone)!.role}</span></button></li>`).join('')}</ul>
    <h2>ماذا تجرّب؟</h2>
    <ol>${TRY.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>
    <div class="demo-row"><button type="button" data-act="reset">إعادة البيانات للبداية</button><button type="button" data-act="close">إغلاق</button></div>`;
  const toggle = (open: boolean) => { panel.hidden = !open; pill.setAttribute('aria-expanded', String(open)); };
  pill.onclick = () => toggle(panel.hidden);
  panel.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.user) signInAs(server, b.dataset.user);
    else if (b.dataset.act === 'reset') { server.reset(); try { localStorage.removeItem('sg.refresh'); localStorage.removeItem('sg.user'); } catch { /* ignore */ } location.hash = '/'; location.reload(); }
    else if (b.dataset.act === 'close') toggle(false);
  };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { toggle(false); pill.focus(); } });
  document.body.append(pill, panel);
  if (!current) toggle(true);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
