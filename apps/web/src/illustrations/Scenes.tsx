/**
 * Original flat illustrations for Jamiyati (owner request 2026-11-10: "motion graphics and simple animated images where
 * they fit"). Drawn in-house as inline SVG: no image files, colors come from CSS tokens so every skin works, and all
 * motion is CSS (transform/opacity only) that stops under prefers-reduced-motion.
 *
 * WelcomeScene — sign-in hero: a member welcoming you, with the app's real features floating around her
 *                (draw, approval, receipt, chat, reminders, privacy).
 * CelebrateScene — milestones (draw done, order adopted, payment confirmed, circle created/joined).
 */
import type { CSSProperties, ReactElement } from 'react';

const i = (n: number) => ({ '--i': n } as CSSProperties);

/** 4-point sparkle centred on 0,0. */
const Sparkle = ({ x, y, s, n, cls = 'ill-gold' }: { x: number; y: number; s: number; n: number; cls?: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path className={`ill-spark ${cls}`} style={i(n)} d="M0 -10 C1.2 -2.2 2.2 -1.2 10 0 C2.2 1.2 1.2 2.2 0 10 C-1.2 2.2 -2.2 1.2 -10 0 C-2.2 -1.2 -1.2 -2.2 0 -10Z" />
  </g>
);
const Plus = ({ x, y, n }: { x: number; y: number; n: number }) => (
  <path className="ill-spark ill-plus" style={i(n)} transform={`translate(${x} ${y})`} d="M0 -6V6M-6 0H6" />
);

/** Feature badges: each icon is drawn around 0,0 inside a 24px circle. */
const ICONS: Record<string, ReactElement> = {
  draw: (
    <g className="ill-stroke ill-gold-s">
      <path d="M-11 -6h5l10 12h6M-11 6h5l10 -12h6" /><path d="M8 -9l3 3 -3 3M8 3l3 3 -3 3" />
    </g>
  ),
  approve: (
    <g>
      <path className="ill-green-fill ill-stroke ill-green-s" d="M0 -12l10 4v6c0 7 -5 11 -10 13c-5 -2 -10 -6 -10 -13v-6z" />
      <path className="ill-stroke ill-green-s" d="M-4.5 0.5l3 3 6 -6.5" />
    </g>
  ),
  receipt: (
    <g className="ill-stroke ill-blue-s">
      <path className="ill-blue-fill" d="M-8 -11h16v22l-4 -3 -4 3 -4 -3 -4 3z" /><path d="M-4 -5h8M-4 0h8M-4 5h4" />
    </g>
  ),
  chat: (
    <g>
      <path className="ill-gold-fill ill-stroke ill-gold-s" d="M-10 -9h20a3 3 0 0 1 3 3v9a3 3 0 0 1 -3 3h-11l-6 5v-5h-3a3 3 0 0 1 -3 -3v-9a3 3 0 0 1 3 -3z" />
      <circle className="ill-dot" cx="-5" cy="-1.5" r="1.6" /><circle className="ill-dot" cx="0" cy="-1.5" r="1.6" /><circle className="ill-dot" cx="5" cy="-1.5" r="1.6" />
    </g>
  ),
  remind: (
    <g className="ill-stroke ill-green-s">
      <path className="ill-green-fill" d="M-8 5v-5a8 8 0 0 1 16 0v5l3 3h-22z" /><path d="M-3 10.5a3 3 0 0 0 6 0M0 -11v3" />
    </g>
  ),
  privacy: (
    <g className="ill-stroke ill-blue-s">
      <rect className="ill-blue-fill" x="-9" y="-3" width="18" height="14" rx="3" /><path d="M-5 -3v-4a5 5 0 0 1 10 0v4M0 3v3" />
    </g>
  ),
};
const Badge = ({ x, y, icon, n }: { x: number; y: number; icon: string; n: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <g className="ill-badge" style={i(n)}>
      <circle className="ill-badge-disc" r="24" />
      {ICONS[icon]}
    </g>
  </g>
);

export function WelcomeScene({ label }: { label: string }) {
  return (
    <svg className="ill ill-welcome" viewBox="0 0 420 330" role="img" aria-label={label}>
      <defs>
        {/* the figure is cropped by the backdrop's lower curve, like a cut-out */}
        <clipPath id="sg-welcome-crop"><rect x="0" y="0" width="420" height="250" /><path d="M64 214C40 148 86 82 158 70C214 61 236 98 288 92C352 85 392 132 380 196C368 262 304 300 222 304C140 308 86 276 64 214Z" /></clipPath>
      </defs>
      <path className="ill-blob" d="M64 214C40 148 86 82 158 70C214 61 236 98 288 92C352 85 392 132 380 196C368 262 304 300 222 304C140 308 86 276 64 214Z" />
      <Plus x={120} y={148} n={1} /><Plus x={318} y={258} n={3} /><Plus x={36} y={118} n={5} />
      <Sparkle x={388} y={40} s={1.3} n={0} /><Sparkle x={34} y={300} s={1.1} n={2} /><Sparkle x={300} y={136} s={0.7} n={4} cls="ill-blue" />

      {/* member in hijab, eyes closed in a smile, welcoming with open arms */}
      <g className="ill-person" clipPath="url(#sg-welcome-crop)">
        <path className="ill-cloth ill-line" d="M138 340C138 272 150 230 210 224C270 230 282 272 282 340Z" />
        <path className="ill-cloth ill-line" d="M152 234C132 244 114 238 100 218L92 226C112 254 150 260 172 248Z" />
        <g className="ill-hand-left">
          <ellipse className="ill-skin ill-line" cx="90" cy="216" rx="13" ry="8" transform="rotate(-24 90 216)" />
          <path className="ill-line ill-none" d="M80 214q-4 -6 1 -9" />
        </g>
        <g className="ill-wave">
          <path className="ill-cloth ill-line" d="M268 234C292 232 308 206 312 170L328 174C324 220 298 256 264 250Z" />
          <path className="ill-skin ill-line" d="M311 172c-5 -10 -6 -20 -2 -30c1 -3 5 -3 6 0l1 10 2 -16c1 -4 6 -4 6 0l0 15 3 -14c1 -4 6 -3 6 1l-2 15 5 -10c2 -3 6 -2 5 2l-6 18c-2 8 -7 13 -14 14z" />
        </g>
        <path className="ill-gold-deep ill-line" d="M210 64C248 64 268 92 266 128C264 152 256 168 264 186C274 204 286 214 290 226C252 236 168 236 130 226C134 214 146 204 156 186C164 168 156 152 154 128C152 92 172 64 210 64Z" />
        <path className="ill-gold ill-line" d="M162 176C176 214 244 214 258 176C264 192 270 204 276 214C250 240 170 240 144 214C150 204 156 192 162 176Z" />
        <ellipse className="ill-gold" cx="210" cy="128" rx="35" ry="40" />
        <ellipse className="ill-skin ill-line" cx="210" cy="130" rx="28" ry="33" />
        <circle className="ill-blush" cx="193" cy="140" r="4.5" /><circle className="ill-blush" cx="227" cy="140" r="4.5" />
        <path className="ill-line ill-none ill-thick" d="M195 127q5 5 10 0M215 127q5 5 10 0" />
        <path className="ill-mouth" d="M200 144q10 12 20 0z" />
      </g>

      <Badge x={84} y={104} icon="draw" n={0} />
      <Badge x={148} y={36} icon="approve" n={1} />
      <Badge x={274} y={34} icon="receipt" n={2} />
      <Badge x={352} y={92} icon="chat" n={3} />
      <Badge x={366} y={220} icon="remind" n={4} />
      <Badge x={50} y={252} icon="privacy" n={5} />
    </svg>
  );
}

const Coin = ({ x, y, n }: { x: number; y: number; n: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <g className="ill-coin" style={i(n)}>
      <circle className="ill-gold ill-line" r="10" /><circle className="ill-none ill-gold-deep-s" r="5.5" />
    </g>
  </g>
);

export function CelebrateScene({ label }: { label: string }) {
  return (
    <svg className="ill ill-celebrate" viewBox="0 0 320 230" role="img" aria-label={label}>
      <path className="ill-blob" d="M44 160C30 104 70 58 130 54C172 51 188 74 226 70C276 64 300 104 290 150C280 200 232 222 164 222C100 222 56 206 44 160Z" />
      <Sparkle x={36} y={44} s={1} n={0} /><Sparkle x={288} y={36} s={1.2} n={2} /><Sparkle x={296} y={196} s={0.8} n={4} cls="ill-blue" />
      <Plus x={64} y={198} n={1} /><Plus x={250} y={112} n={3} />

      <g className="ill-coins">
        <Coin x={160} y={38} n={0} /><Coin x={122} y={52} n={1} /><Coin x={198} y={50} n={2} /><Coin x={96} y={30} n={3} /><Coin x={226} y={26} n={4} />
      </g>

      {/* member in ghutra and agal, both arms raised */}
      <g className="ill-person ill-cheer">
        <path className="ill-thobe ill-line" d="M106 230C108 176 122 152 160 150C198 152 212 176 214 230Z" />
        <path className="ill-thobe ill-line" d="M124 166C104 146 94 118 98 92L112 90C112 116 120 138 138 156Z" />
        <path className="ill-thobe ill-line" d="M196 166C216 146 226 118 222 92L208 90C208 116 200 138 182 156Z" />
        <circle className="ill-skin ill-line" cx="104" cy="82" r="10" /><circle className="ill-skin ill-line" cx="216" cy="82" r="10" />
        <path className="ill-thobe ill-line" d="M160 54C194 54 206 82 204 108L214 158L106 158L116 108C114 82 126 54 160 54Z" />
        <path className="ill-ghutra-fold ill-none" d="M126 120L118 156M194 120L202 156" />
        <ellipse className="ill-skin ill-line" cx="160" cy="102" rx="24" ry="28" />
        <path className="ill-beard" d="M137 104C139 132 181 132 183 104C177 121 143 121 137 104Z" />
        <path className="ill-line ill-none ill-thick" d="M146 98q5 -5 10 0M164 98q5 -5 10 0" />
        <path className="ill-mouth" d="M150 112q10 12 20 0z" />
        <path className="ill-agal" d="M122 76Q160 60 198 76" /><path className="ill-agal" d="M120 84Q160 68 200 84" />
      </g>
    </svg>
  );
}
