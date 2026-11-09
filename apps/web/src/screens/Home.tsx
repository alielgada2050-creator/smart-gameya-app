import { api, type SessionUser } from '../api.ts';
import { ErrorNote, Loading, Pill, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { Obligations } from './Obligations.tsx';

export function Home({ user }: { user: SessionUser }) {
  const { t, lang } = useT();
  const circles = useLoad(() => api<any[]>('GET', '/gamiyas'));

  return (
    <div className="stack">
      <h1>{t.hello(user.fullName)}</h1>
      <Obligations />
      <section className="stack-sm">
        <div className="row">
          <h2>{t.circles}</h2>
          <a className="btn btn-secondary" href="#/new">{t.newCircle}</a>
        </div>
        <ErrorNote error={circles.error} />
        {!circles.data ? <Loading /> : circles.data.length === 0 ? (
          <div className="panel quiet stack-sm">
            <p>{t.noCircles}</p>
            <a href="#/join">{t.join}</a>
          </div>
        ) : (
          <ul className="list panel">
            {circles.data.slice(0, 4).map((c) => (
              <li key={c.id}>
                <a href={`#/c/${c.id}`} className="row" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="stack-sm" style={{ gap: 0 }}>
                    <strong>{c.name}</strong>
                    <span className="muted small">{money(c.contribution, lang)} {t.perMonth[c.frequency]}{t.sep}{c.myPayoutPosition ? `${t.turnShort}: ${c.myPayoutPosition}` : date(c.startDate, lang)}</span>
                  </span>
                  <Pill status={c.status} label={t.status[c.status]} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
