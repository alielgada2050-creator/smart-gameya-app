import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { EmptyState, ErrorNote } from '../components.tsx';
import { time, useT } from '../i18n.ts';
import { Icon } from '../shell/icons.tsx';

/**
 * Circle chat: members' messages, the circle record (every transfer, approval, dispute and draw is posted
 * automatically) and the assistant. Text only; polled every 5 seconds.
 */
export function Chat({ id, onEvent }: { id: string; onEvent?: () => void }) {
  const { t, lang } = useT();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef(0);
  const log = useRef<HTMLDivElement>(null);

  async function pull() {
    try {
      const fresh = await api<any[]>('GET', `/gamiyas/${id}/chat?after=${last.current}`);
      if (fresh.length) {
        last.current = fresh[fresh.length - 1].id;
        setMsgs((m) => [...m, ...fresh]);
        if (fresh.some((m) => m.kind === 'SYSTEM')) onEvent?.();
      }
    } catch (e) { setError(e); }
  }

  useEffect(() => {
    last.current = 0; setMsgs([]);
    pull();
    const h = setInterval(pull, 5000);
    return () => clearInterval(h);
  }, [id]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs.length]);

  async function send(body: string) {
    if (!body.trim()) return;
    setBusy(true); setError(null);
    try { await api('POST', `/gamiyas/${id}/chat`, { body: body.trim() }); setText(''); await pull(); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  const who = (m: any) => (m.kind === 'ASSISTANT' ? t.assistant : m.kind === 'SYSTEM' ? t.system : m.mine ? t.you : m.sender);
  return (
    <section className="panel chat" data-testid="chat">
      <div className="chat-log" ref={log} aria-live="polite">
        {msgs.length === 0 ? <EmptyState figure="relay" text={t.emptyChat} /> : msgs.map((m) => (
          <div key={m.id} className={`msg ${m.kind}${m.mine ? ' mine' : ''}`} data-kind={m.kind}>
            <span className="who">{who(m)}</span>
            {m.body}
            <time dateTime={m.at}>{time(m.at, lang)}</time>
          </div>
        ))}
      </div>
      <div className="stack-sm">
        <div className="chips">
          {Object.keys(t.quick).map((k) => <button key={k} type="button" className="chip" disabled={busy} onClick={() => send(t.quick[k])}>{t.quickLabel[k]}</button>)}
        </div>
        <ErrorNote error={error} />
        <form className="chat-form" onSubmit={(e: FormEvent) => { e.preventDefault(); send(text); }}>
          <input aria-label={t.chatPlaceholder} placeholder={t.chatPlaceholder} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label={t.send}><Icon name="send" /></button>
        </form>
      </div>
    </section>
  );
}
