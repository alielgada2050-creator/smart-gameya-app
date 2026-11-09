import { api, type SessionUser } from '../api.ts';
import { EmptyState, ErrorNote, Loading, Pill, TierChip, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { Obligations } from './Obligations.tsx';

export function Home({ user }: { user: SessionUser }) {
  const { t, lang } = useT();
  const circles = useLoad(() => api<any[]>('GET', '/gamiyas'));

  return (
    <div className="cols">
      <div className="stack">
        <h1>{t.hello(user.fullName)}</h1>
        <Obligations />
      </div>
      <section className="stack-sm">
        <div className="row">
          <h2>{t.circles}</h2>
          <a className="btn btn-secondary" href="#/new">{t.newCircle}</a>
        </div>
        <ErrorNote error={circles.error} />
        {!circles.data ? <Loading /> : circles.data.length === 0 ? (
          <div className="panel"><EmptyState figure="plot" text={t.noCircles}><a className="btn btn-secondary" href="#/join">{t.join}</a></EmptyState></div>
        ) : (
          <ul className="list panel">
            {circles.data.slice(0, 6).map((c) => (
              <li key={c.id}>
                <a href={`#/c/${c.id}`} className="row" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="stack-sm" style={{ gap: 2 }}>
                    <strong>{c.name}</strong>
                    <span className="muted small">{money(c.contribution, lang, c.currency)} {t.perMonth[c.frequency]}{t.sep}{c.myPayoutPosition ? `${t.turnShort}: ${c.myPayoutPosition}` : date(c.startDate, lang)}</span>
                  </span>
                  <span className="row-start"><TierChip tier={c.tier} label={t.tierName[c.tier]} /><Pill status={c.status} label={t.status[c.status]} /></span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
