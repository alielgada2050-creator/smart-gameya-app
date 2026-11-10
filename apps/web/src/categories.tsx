/**
 * Circle types and personal goals (family, friends, colleagues, school, Hajj/Umrah, wedding, Ramadan/Eid, the Friday circle…).
 * Each has an original line glyph (24px, stroke = currentColor), a gradient used behind the glyph, and a starting template
 * for the create wizard. Templates only pre-fill the form: the server validates and computes every figure.
 */
import type { ReactElement } from 'react';

export type Category = 'FAMILY' | 'FRIENDS' | 'WORK' | 'SCHOOL' | 'HAJJ' | 'WEDDING' | 'RAMADAN' | 'FRIDAY' | 'TRAVEL' | 'HOME' | 'CAR' | 'OTHER';
export const CIRCLE_TYPES: Category[] = ['FAMILY', 'FRIENDS', 'WORK', 'SCHOOL', 'HAJJ', 'WEDDING', 'RAMADAN', 'FRIDAY'];
export const GOAL_TYPES: Category[] = ['HAJJ', 'SCHOOL', 'WEDDING', 'RAMADAN', 'TRAVEL', 'HOME', 'CAR', 'OTHER'];

export interface Template { frequency: 'MONTHLY' | 'WEEKLY'; memberCount: number; contribution: string }
export const TEMPLATES: Record<Category, Template> = {
  FAMILY: { frequency: 'MONTHLY', memberCount: 10, contribution: '1000' },
  FRIENDS: { frequency: 'MONTHLY', memberCount: 6, contribution: '1000' },
  WORK: { frequency: 'MONTHLY', memberCount: 12, contribution: '1500' },
  SCHOOL: { frequency: 'MONTHLY', memberCount: 10, contribution: '500' },
  HAJJ: { frequency: 'MONTHLY', memberCount: 10, contribution: '2500' },
  WEDDING: { frequency: 'MONTHLY', memberCount: 10, contribution: '3000' },
  RAMADAN: { frequency: 'MONTHLY', memberCount: 6, contribution: '1000' },
  FRIDAY: { frequency: 'WEEKLY', memberCount: 8, contribution: '200' },
  TRAVEL: { frequency: 'MONTHLY', memberCount: 8, contribution: '1000' },
  HOME: { frequency: 'MONTHLY', memberCount: 12, contribution: '2000' },
  CAR: { frequency: 'MONTHLY', memberCount: 12, contribution: '2500' },
  OTHER: { frequency: 'MONTHLY', memberCount: 10, contribution: '1000' },
};

const glyphs: Record<Category, ReactElement> = {
  FAMILY: <><circle cx="8" cy="7" r="2.6" /><circle cx="16" cy="7" r="2.6" /><circle cx="12" cy="13" r="2.1" /><path d="M3.5 20c.5-3.4 2.3-5.4 4.5-5.6M20.5 20c-.5-3.4-2.3-5.4-4.5-5.6M8.5 21c.4-2.4 1.8-3.8 3.5-3.8s3.1 1.4 3.5 3.8" /></>,
  FRIENDS: <><circle cx="9" cy="8" r="3" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M3.5 20c.8-3.7 3-5.6 5.5-5.6s4.7 1.9 5.5 5.6M15 14.6c2.6-.3 4.6 1.4 5.5 4.6" /></>,
  WORK: <><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 12.5h17M11 12.5v2h2v-2" /></>,
  SCHOOL: <><path d="M12 4 2.5 8.5 12 13l9.5-4.5z" /><path d="M6.5 10.5v4.6c1.5 1.6 3.4 2.4 5.5 2.4s4-.8 5.5-2.4v-4.6M21.5 8.5v6" /></>,
  HAJJ: <><path d="M4.5 9 12 5.5 19.5 9v9.5L12 21.5l-7.5-3z" /><path d="M4.5 9 12 12.5 19.5 9M12 12.5v9M4.5 12.2 12 15.7l7.5-3.5" /></>,
  WEDDING: <><circle cx="9" cy="14" r="5" /><circle cx="15" cy="14" r="5" /><path d="m13 5.5 2-2.5 2 2.5-2 2z" /></>,
  RAMADAN: <><path d="M15.5 3.5A8.5 8.5 0 1 0 20.5 15a7 7 0 0 1-5-11.5Z" /><path d="M18 3.5v2.4M16.8 4.7h2.4" /></>,
  FRIDAY: <><rect x="3.5" y="5" width="17" height="15" rx="2.2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><path d="m12 12 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5L11 14z" /></>,
  TRAVEL: <><path d="M3 13.5 21 7l-2.5 3.2L11 13l-1.5 5-2-.7.6-3.6-4.6-.2z" /></>,
  HOME: <><path d="M4 11 12 4.5 20 11" /><path d="M6 9.5V20h12V9.5M10 20v-5h4v5" /></>,
  CAR: <><path d="M4.5 16.5v-3.2l1.7-4.4A2 2 0 0 1 8.1 7.5h7.8a2 2 0 0 1 1.9 1.4l1.7 4.4v3.2z" /><circle cx="8" cy="16.5" r="1.8" /><circle cx="16" cy="16.5" r="1.8" /><path d="M4.5 13.3h15" /></>,
  OTHER: <><path d="M12 3.5 14 9.5l6 .2-4.8 3.7 1.8 6-5-3.6-5 3.6 1.8-6L4 9.7l6-.2z" /></>,
};

export function CategoryGlyph({ c, className = 'icon' }: { c: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {glyphs[(c in glyphs ? c : 'OTHER') as Category]}
    </svg>
  );
}

/** Round badge: the glyph in white on the type's gradient (see .cat-badge.<TYPE> in styles.css). */
export function CategoryBadge({ c, size = 'md' }: { c: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`cat-badge ${c} ${size}`} aria-hidden="true"><CategoryGlyph c={c} /></span>;
}
