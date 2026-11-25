import { api, type SessionUser } from '../api.ts';
import { EmptyState, ErrorNote, Loading, Pill, TierChip, useLoad } from '../components.tsx';
import { date, money, useT } from '../i18n.ts';
import { CIRCLE_TYPES, CategoryBadge } from '../categories.tsx';
import { Obligations } from './Obligations.tsx';
import { GoalProgress } from './Goals.tsx';
import { MyInvitations } from './DirectInvite.tsx';
import { InviteFriends } from './InviteFriends.tsx';

const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

export function Home({ user }: { user: SessionUser }) {
  const { t, lang } = useT();
  const circles = useLoad(() => api<any[]>('GET', '/gamiyas'));
  const goals = useLoad(() => api<any[]>('GET', '/me/goals'));
  const today = riyadhToday();
  const next = (circles.data ?? []).filter((c) => c.myPayoutDate && c.myPayoutDate >= today).sort((a, b) => a.myPayoutDate.localeCompare(b.myPayoutDate))[0];

  return (
    <div className="cols">
      <div className="stack">
        <h1>{t.hello(user.fullName)}</h1>
        <section className="hero-card" aria-label={t.home2.nextPayout} data-testid="hero">
          <span className="hero-label">{t.home2.nextPayout}</span>
          {next ? (
            <>
              <strong className="hero-figure">{money(next.potPerCycle, lang, next.currency)}</strong>
              <span>{date(next.myPayoutDate, lang)}{t.sep}{next.name}</span>
              <span className="hero-chip">{t.home2.turnOf(next.myPayoutPosition, next.memberCount)}</span>
            </>
          ) : (
            <>
              <strong className="hero-figure small-figure">{t.home2.noPayout}</strong>
              {circles.data && <span>{t.home2.active(circles.data.length)}</span>}
            </>
          )}
          <span className="hero-actions">
            <a className="btn btn-on-dark" href="#/new">{t.newCircle}</a>
            <a className="btn btn-ghost-dark" href="#/join">{t.join}</a>
          </span>
        </section>
        <MyInvitations />
        <Obligations />
        <section className="stack-sm">
          <div className="row"><h2>{t.circles}</h2>{circles.data && circles.data.length > 6 && <a href="#/circles">{t.circles}</a>}</div>
          <ErrorNote error={circles.error} />
          {!circles.data ? <Loading /> : circles.data.length === 0 ? (
            <div className="panel"><EmptyState figure="plot" text={t.noCircles}><a className="btn btn-secondary" href="#/join">{t.join}</a></EmptyState></div>
          ) : (
            <ul className="list panel">
              {circles.data.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <a href={`#/c/${c.id}`} className="row" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span className="row-start" style={{ flexWrap: 'nowrap' }}>
                      <CategoryBadge c={c.category} size="sm" />
                      <span className="stack-sm" style={{ gap: 2 }}>
                        <strong>{c.name}</strong>
                        <span className="muted small">{money(c.contribution, lang, c.currency)} {t.perMonth[c.frequency]}{t.sep}{c.myPayoutPosition ? `${t.turnShort}: ${c.myPayoutPosition}` : date(c.startDate, lang)}</span>
                      </span>
                    </span>
                    <span className="row-start">
                      {c.myMemberStatus === 'PENDING_APPROVAL' && <Pill status="PENDING" label={t.reconfirm.title} />}
                      <TierChip tier={c.tier} label={t.tierName[c.tier]} /><Pill status={c.status} label={t.status[c.status]} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="stack">
        <section className="stack-sm">
          <h2>{t.home2.startFor}</h2>
          <div className="type-grid compact" data-testid="start-types">
            {CIRCLE_TYPES.map((c) => (
              <a key={c} className="type-tile" href={`#/new?type=${c}`}>
                <CategoryBadge c={c} size="sm" /><span>{t.cat[c]}</span>
              </a>
            ))}
          </div>
        </section>
        <InviteFriends name={user.fullName} />
        <section className="panel stack-sm">
          <div className="row"><h2>{t.home2.myGoals}</h2><a href="#/goals">{t.home2.allGoals}</a></div>
          {!goals.data ? <Loading lines={2} /> : goals.data.length === 0 ? (
            <><p className="muted small">{t.goals.none}</p><a className="btn btn-secondary" href="#/goals">{t.home2.addGoal}</a></>
          ) : (
            <ul className="list">
              {goals.data.slice(0, 3).map((g) => (
                <li key={g.id} className="stack-sm">
                  <span className="row-start"><CategoryBadge c={g.category} size="sm" /><strong>{g.title}</strong><span className="muted small">{money(g.targetAmount, lang, g.currency)}</span></span>
                  {g.circle && <GoalProgress g={g} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
