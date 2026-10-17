// Flat vector illustrations drawn for Foodo. They are decorative (aria-hidden) and take their colours
// from the theme tokens, so they follow the light and dark themes. They are never presented as photos.

import type { ReactNode } from 'react';

export type IllustrationName = 'family' | 'goal' | 'diet' | 'ban' | 'taste' | 'kitchen' | 'calendar' | 'summary' | 'cooking' | 'basket';

function Frame({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg className="illustration" viewBox="0 0 240 160" role={label ? 'img' : undefined} aria-hidden={label ? undefined : true} aria-label={label}>
      <ellipse cx="120" cy="146" rx="92" ry="9" fill="var(--surface-3)" />
      {children}
    </svg>
  );
}

const leaf = (x: number, y: number, r: number, fill = 'var(--brand)') => (
  <path d={`M${x} ${y}c${8 * r} ${-10 * r} ${20 * r} ${-10 * r} ${24 * r} ${-4 * r}c${-4 * r} ${10 * r} ${-16 * r} ${14 * r} ${-24 * r} ${4 * r}z`} fill={fill} />
);

const ART: Record<IllustrationName, () => ReactNode> = {
  family: () => (
    <>
      <circle cx="86" cy="64" r="20" fill="var(--accent)" />
      <rect x="62" y="86" width="48" height="56" rx="22" fill="var(--primary)" />
      <circle cx="150" cy="58" r="22" fill="var(--saffron)" />
      <rect x="124" y="82" width="52" height="60" rx="24" fill="var(--tomato)" />
      <circle cx="118" cy="96" r="13" fill="var(--berry)" />
      <rect x="104" y="110" width="28" height="32" rx="13" fill="var(--sky)" />
      <circle cx="80" cy="60" r="2.5" fill="var(--text)" />
      <circle cx="92" cy="60" r="2.5" fill="var(--text)" />
      <circle cx="144" cy="54" r="2.5" fill="var(--text)" />
      <circle cx="156" cy="54" r="2.5" fill="var(--text)" />
      <path d="M81 70q5 5 10 0M145 64q5 5 10 0" stroke="var(--text)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </>
  ),
  goal: () => (
    <>
      <circle cx="120" cy="84" r="54" fill="var(--surface)" stroke="var(--border)" strokeWidth="3" />
      <circle cx="120" cy="84" r="38" fill="var(--accent-soft)" />
      <circle cx="120" cy="84" r="22" fill="var(--accent)" />
      <circle cx="120" cy="84" r="8" fill="var(--surface)" />
      <path d="M120 84 186 30" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" />
      <path d="m178 24 14 2-4 14z" fill="var(--primary)" />
      {leaf(36, 120, 1)}
      {leaf(196, 118, 0.8, 'var(--saffron)')}
    </>
  ),
  diet: () => (
    <>
      <ellipse cx="120" cy="104" rx="76" ry="30" fill="var(--surface)" stroke="var(--border)" strokeWidth="3" />
      <ellipse cx="120" cy="100" rx="62" ry="22" fill="var(--brand-soft)" />
      <circle cx="96" cy="94" r="12" fill="var(--tomato)" />
      <circle cx="124" cy="88" r="14" fill="var(--brand)" />
      <circle cx="148" cy="98" r="10" fill="var(--accent)" />
      <circle cx="112" cy="106" r="7" fill="var(--saffron)" />
      <path d="M124 74c0-10 6-16 14-18" stroke="var(--brand)" strokeWidth="4" fill="none" strokeLinecap="round" />
      {leaf(132, 60, 0.9)}
    </>
  ),
  ban: () => (
    <>
      <circle cx="120" cy="82" r="56" fill="var(--danger-soft)" />
      <path d="M92 66c10-14 46-14 56 0 6 10 0 32-28 40-28-8-34-30-28-40z" fill="var(--saffron)" />
      <path d="M100 70h40M104 82h32" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="120" cy="82" r="56" fill="none" stroke="var(--danger)" strokeWidth="8" />
      <path d="m81 43 78 78" stroke="var(--danger)" strokeWidth="8" strokeLinecap="round" />
    </>
  ),
  taste: () => (
    <>
      <path d="M58 110c8-36 40-58 62-58s54 22 62 58z" fill="var(--accent-soft)" />
      <path d="M86 70c14-12 22-30 20-46 18 10 24 34 12 52z" fill="var(--tomato)" />
      <path d="M104 24c4-6 10-8 16-6" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="152" cy="80" r="16" fill="var(--saffron)" />
      <circle cx="146" cy="76" r="3" fill="var(--surface)" />
      <path d="M60 110h120a10 10 0 0 1 0 20H60a10 10 0 0 1 0-20z" fill="var(--primary)" />
      {leaf(172, 52, 0.8)}
    </>
  ),
  kitchen: () => (
    <>
      <rect x="58" y="70" width="124" height="70" rx="14" fill="var(--surface)" stroke="var(--border)" strokeWidth="3" />
      <rect x="72" y="92" width="96" height="36" rx="8" fill="var(--surface-2)" />
      <circle cx="80" cy="80" r="4" fill="var(--accent)" />
      <circle cx="94" cy="80" r="4" fill="var(--saffron)" />
      <path d="M86 70V50a8 8 0 0 1 8-8h52a8 8 0 0 1 8 8v20" fill="var(--primary)" />
      <path d="M78 48h-8M170 48h-8" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" />
      <path d="M104 34c0-6 6-6 6-12M126 34c0-6 6-6 6-12" stroke="var(--faint)" strokeWidth="3" strokeLinecap="round" fill="none" className="steam" />
      <circle cx="186" cy="40" r="20" fill="var(--surface)" stroke="var(--text)" strokeWidth="3" />
      <path d="M186 28v12l8 6" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" fill="none" />
    </>
  ),
  calendar: () => (
    <>
      <rect x="62" y="36" width="116" height="104" rx="16" fill="var(--surface)" stroke="var(--border)" strokeWidth="3" />
      <path d="M62 52a16 16 0 0 1 16-16h84a16 16 0 0 1 16 16v14H62z" fill="var(--primary)" />
      <path d="M90 28v16M150 28v16" stroke="var(--text)" strokeWidth="5" strokeLinecap="round" />
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => (
          <rect key={`${r}-${c}`} x={74 + c * 20} y={76 + r * 15} width="12" height="9" rx="3" fill={(r * 5 + c) % 4 === 0 ? 'var(--accent)' : 'var(--surface-3)'} />
        )),
      )}
      <circle cx="184" cy="124" r="22" fill="var(--saffron)" />
      <text x="184" y="131" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text)">₽</text>
    </>
  ),
  summary: () => (
    <>
      <rect x="70" y="26" width="100" height="120" rx="14" fill="var(--surface)" stroke="var(--border)" strokeWidth="3" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx="90" cy={52 + i * 24} r="7" fill={i === 3 ? 'var(--surface-3)' : 'var(--primary)'} />
          {i < 3 && <path d={`m86 ${52 + i * 24} 3 3 6-6`} stroke="var(--primary-ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
          <rect x="104" y={48 + i * 24} width={i === 1 ? 40 : 52} height="8" rx="4" fill="var(--surface-3)" />
        </g>
      ))}
      {leaf(168, 120, 1)}
      <circle cx="62" cy="112" r="12" fill="var(--accent)" />
    </>
  ),
  cooking: () => (
    <>
      <path d="M60 92h120c0 30-27 50-60 50S60 122 60 92z" fill="var(--primary)" />
      <ellipse cx="120" cy="92" rx="60" ry="12" fill="var(--accent)" />
      <circle cx="100" cy="90" r="6" fill="var(--tomato)" />
      <circle cx="122" cy="88" r="7" fill="var(--saffron)" />
      <circle cx="142" cy="91" r="5" fill="var(--brand)" />
      <path className="steam" d="M96 70c0-8 8-8 8-16s-8-8-8-16" stroke="var(--faint)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path className="steam delay" d="M120 70c0-8 8-8 8-16s-8-8-8-16" stroke="var(--faint)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path className="steam delay2" d="M144 70c0-8 8-8 8-16s-8-8-8-16" stroke="var(--faint)" strokeWidth="4" strokeLinecap="round" fill="none" />
    </>
  ),
  basket: () => (
    <>
      <path d="M58 76h124l-12 60H70z" fill="var(--accent)" />
      <path d="M58 76h124" stroke="var(--text)" strokeWidth="5" strokeLinecap="round" />
      <path d="M86 76l14-34M154 76l-14-34" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="96" cy="70" r="14" fill="var(--tomato)" />
      <circle cx="140" cy="68" r="12" fill="var(--saffron)" />
      <path d="M112 74c0-16 6-28 16-32 2 14-4 26-16 32z" fill="var(--brand)" />
      <path d="M78 96h84M74 114h92" stroke="var(--accent-ink)" strokeWidth="3" opacity="0.35" />
    </>
  ),
};

export function Illustration({ name, label }: { name: IllustrationName; label?: string }) {
  const draw = ART[name];
  return <Frame label={label}>{draw()}</Frame>;
}
