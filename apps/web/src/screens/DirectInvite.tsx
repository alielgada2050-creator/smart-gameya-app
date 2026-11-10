/**
 * «ادعُ مباشرة»: pick people you already share a circle with (one tap: everyone) and/or type phone numbers. Registered
 * people get the invitation in the app at once; other numbers get a ready WhatsApp message to that number.
 */
import { useMemo, useState } from 'react';
import { api, normalizePhone } from '../api.ts';
import { ErrorNote, Loading, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { WEB_ORIGIN } from '../platform.ts';
import { CategoryBadge } from '../categories.tsx';

export function DirectInvite({ id, name, remaining }: { id: string; name: string; remaining: number }) {
  const { t } = useT();
  const sug = useLoad(() => api<any[]>('GET', `/gamiyas/${id}/invite-suggestions`), [id]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState('');
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => typed.split(/[\s,،;]+/).filter(Boolean).map((x) => ({ raw: x, phone: normalizePhone(x) })), [typed]);
  const bad = parsed.filter((p) => !p.phone);
  const phones = [...new Set([...picked, ...parsed.flatMap((p) => (p.phone ? [p.phone] : []))])];
  const open = (sug.data ?? []).filter((s) => s.invited !== 'PENDING' && s.invited !== 'ACCEPTED');

  async function send() {
    setBusy(true); setError(null);
    try { setRes(await api('POST', `/gamiyas/${id}/invitations/direct`, { phones })); setPicked(new Set()); setTyped(''); sug.reload(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  const toggle = (p: string) => { const n = new Set(picked); n.has(p) ? n.delete(p) : n.add(p); setPicked(n); };

  return (
    <section className="panel stack-sm" data-testid="direct-invite">
      <h2>{t.direct.title}</h2>
      <p className="muted small">{t.direct.intro(remaining)}</p>
      {!sug.data ? <Loading lines={2} /> : open.length > 0 && (
        <div className="stack-sm">
          <div className="row">
            <h3>{t.direct.people}</h3>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setPicked(picked.size === open.length ? new Set() : new Set(open.map((s) => s.phone)))}>
              {picked.size === open.length ? t.direct.none : t.direct.all(open.length)}</button>
          </div>
          <ul className="pick-list">
            {open.map((s) => (
              <li key={s.userId}>
                <label className="check"><input type="checkbox" checked={picked.has(s.phone)} onChange={() => toggle(s.phone)} />
                  <span className="avatar-sm" aria-hidden="true">{s.fullName.slice(0, 1)}</span>
                  <span className="stack-sm" style={{ gap: 0 }}><strong>{s.fullName}</strong><span className="muted small">{t.direct.via(s.via)} · …{s.phoneLast4}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label>{t.direct.phones}
        <textarea rows={2} className="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="05xxxxxxxx, 05xxxxxxxx" aria-describedby="direct-hint" />
      </label>
      <p id="direct-hint" className={`small ${bad.length ? 'field-error' : 'muted'}`}>{bad.length ? t.direct.bad(bad.map((b) => b.raw).join('، ')) : t.direct.hint}</p>
      <ErrorNote error={error} />
      <button className="btn btn-primary" disabled={busy || phones.length === 0 || bad.length > 0} onClick={send}>{t.direct.send(phones.length)}</button>
      {res && (
        <div className="stack-sm" aria-live="polite" data-testid="direct-result">
          {res.notified.length > 0 && <p className="notice ok small">{t.direct.notified(res.notified.map((n: any) => n.fullName).join('، '))}</p>}
          {res.toShare.length > 0 && (
            <>
              <p className="small">{t.direct.notRegistered}</p>
              <ul className="pick-list">
                {res.toShare.map((p: string) => (
                  <li key={p} className="row">
                    <span className="ltr code">{p}</span>
                    <a className="btn btn-whatsapp btn-xs" target="_blank" rel="noopener noreferrer"
                      href={`https://wa.me/${p.replace('+', '')}?text=${encodeURIComponent(t.share.text(name, `${WEB_ORIGIN}/#/join/${res.code}`))}`}>{t.share.whatsapp}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {res.skipped.length > 0 && <p className="muted small">{t.direct.skipped(res.skipped.length)}</p>}
        </div>
      )}
    </section>
  );
}

/** Home card: invitations sent to me (or to my number before I signed up). */
export function MyInvitations() {
  const { t, lang } = useT();
  const inv = useLoad(() => api<any[]>('GET', '/me/invitations'));
  if (!inv.data || inv.data.length === 0) return null;
  return (
    <section className="panel stack-sm invites-card" data-testid="my-invitations" aria-live="polite">
      <h2>{t.direct.forYou(inv.data.length)}</h2>
      <ul className="list">
        {inv.data.map((x) => (
          <li key={x.id} className="row">
            <span className="row-start" style={{ flexWrap: 'nowrap' }}>
              <CategoryBadge c={x.category} size="sm" />
              <span className="stack-sm" style={{ gap: 0 }}>
                <strong>{x.name}</strong>
                <span className="muted small">{t.direct.from(x.organizerName)} · {money(x.contribution, lang, x.currency)} {t.perMonth[x.frequency]} · {date(x.startDate, lang)}</span>
              </span>
            </span>
            <span className="row-start">
              <a className="btn btn-primary btn-xs" href={`#/join/${x.code}`}>{t.direct.review}</a>
              <button className="btn btn-ghost btn-xs" onClick={() => api('POST', `/me/invitations/${x.id}/decline`, {}).then(inv.reload)}>{t.direct.decline}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
