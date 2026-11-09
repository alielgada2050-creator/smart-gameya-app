import { api } from '../api.ts';
import { ErrorNote, Loading, Pill, useLoad } from '../components.tsx';
import { money, useT } from '../i18n.ts';

export function Circles() {
  const { t, lang } = useT();
  const { data, error } = useLoad(() => api<any[]>('GET', '/gamiyas'));
  return (
    <div className="stack">
      <div className="row">
        <h1>{t.circles}</h1>
        <div className="row-start">
          <a className="btn btn-secondary" href="#/join">{t.join}</a>
          <a className="btn btn-primary" href="#/new">{t.newCircle}</a>
        </div>
      </div>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <p className="panel quiet">{t.noCircles}</p> : (
        <ul className="list panel">
          {data.map((c) => (
            <li key={c.id}>
              <a href={`#/c/${c.id}`} className="row" style={{ color: 'inherit', textDecoration: 'none' }}>
                <span>
                  <strong>{c.name}</strong><br />
                  <span className="muted small">{money(c.contribution, lang)} {t.perMonth[c.frequency]}{t.sep}{t.members(c.joined, c.memberCount)}</span>
                </span>
                <Pill status={c.status} label={t.status[c.status]} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
