/** «ادعُ أصدقاءك»: share the app itself (not a circle) by the phone's share sheet, WhatsApp, or a copied link. */
import { useState } from 'react';
import { useT } from '../i18n.ts';
import { WEB_ORIGIN, isNative, shareLink } from '../platform.ts';

export function InviteFriends({ name }: { name: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const link = `${WEB_ORIGIN}/`;
  const text = t.friends.text(name, link);
  const canShare = isNative || (typeof navigator !== 'undefined' && 'share' in navigator);
  return (
    <section className="panel stack-sm invite-friends" data-testid="invite-friends">
      <h2>{t.friends.title}</h2>
      <p className="muted small">{t.friends.body}</p>
      <div className="row-start">
        {canShare && <button className="btn btn-primary btn-xs" onClick={() => shareLink(t.friends.title, link, text)}>{t.friends.share}</button>}
        <a className="btn btn-whatsapp btn-xs" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{t.share.whatsapp}</a>
        <button className="btn btn-secondary btn-xs" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})}>{copied ? t.copied : t.friends.copy}</button>
      </div>
    </section>
  );
}
