import type { ReactElement } from 'react';
/** Small inline icon set (24px grid, stroke = currentColor). Decorative: always aria-hidden. */
const paths: Record<string, ReactElement> = {
  home: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  circles: <><circle cx="12" cy="12" r="7.5" strokeDasharray="3.2 2.6" /><circle cx="12" cy="4.5" r="2" fill="currentColor" /></>,
  advisor: <><path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3Z" /><path d="M9.5 20.5h5" /></>,
  goals: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  account: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
  admin: <><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  skin: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5S14.5 17.9 12 20.5C9.5 17.9 8.5 15.1 8.5 12S9.5 6.1 12 3.5Z" /></>,
  copy: <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></>,
  file: <><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5" /></>,
  send: <path d="M4 12 20 4l-6 16-3-7z" />,
  chat: <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  pay: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  overview: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
};

export function Icon({ name, className = 'icon' }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
