import { useId, type ReactNode } from 'react';

const COLORS: Record<string, string> = {
  blue: '#2f6fe4',
  yellow: '#f2b705',
  red: '#e2262f',
  green: '#23a55a',
  purple: '#7a4be0',
  teal: '#12a6a8',
  orange: '#f07318',
  pink: '#e3408e',
  slate: '#56657d',
};

type Face = 'smile' | 'grin' | 'wink' | 'cool' | 'wow';

function face(kind: Face): ReactNode {
  const eyes = (
    <>
      <rect x="29" y="33" width="9" height="17" rx="4.5" fill="#fff" />
      <rect x="62" y="33" width="9" height="17" rx="4.5" fill="#fff" />
    </>
  );
  const smile = <path d="M26 60 Q50 84 74 60" stroke="#fff" strokeWidth="8" fill="none" strokeLinecap="round" />;
  switch (kind) {
    case 'smile':
      return (
        <>
          {eyes}
          {smile}
        </>
      );
    case 'grin':
      return (
        <>
          <circle cx="34" cy="40" r="6" fill="#fff" />
          <circle cx="66" cy="40" r="6" fill="#fff" />
          <path d="M26 57h48a24 24 0 0 1-48 0z" fill="#fff" />
        </>
      );
    case 'wink':
      return (
        <>
          <path d="M27 43 Q33.5 35 40 43" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" />
          <rect x="62" y="33" width="9" height="17" rx="4.5" fill="#fff" />
          {smile}
        </>
      );
    case 'cool':
      return (
        <>
          <path d="M20 36h60v4c0 7-5 12-12 12h-4c-6 0-10-4-11-9h-6c-1 5-5 9-11 9h-4c-7 0-12-5-12-12z" fill="#111" />
          <path d="M31 66 Q50 78 69 66" stroke="#fff" strokeWidth="7" fill="none" strokeLinecap="round" />
        </>
      );
    case 'wow':
      return (
        <>
          <circle cx="34" cy="40" r="7" fill="#fff" />
          <circle cx="66" cy="40" r="7" fill="#fff" />
          <circle cx="34" cy="41" r="3" fill="rgba(0,0,0,.55)" />
          <circle cx="66" cy="41" r="3" fill="rgba(0,0,0,.55)" />
          <ellipse cx="50" cy="68" rx="9" ry="11" fill="#fff" />
        </>
      );
  }
}

export const AVATARS = [
  'smile-blue',
  'smile-yellow',
  'smile-red',
  'smile-green',
  'smile-purple',
  'smile-teal',
  'grin-orange',
  'grin-pink',
  'grin-blue',
  'wink-red',
  'wink-green',
  'cool-slate',
  'cool-purple',
  'wow-yellow',
  'wow-teal',
  'kids-rainbow',
] as const;

export function Avatar({ id, className = '', title }: { id: string; className?: string; title?: string }) {
  const gradientId = `kids-bg-${useId().replace(/:/g, '')}`;
  if (id === 'kids-rainbow') {
    return (
      <svg className={`avatar ${className}`} viewBox="0 0 100 100" role="img" aria-label={title ?? 'Kids avatar'}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5f6d" />
            <stop offset="0.35" stopColor="#ffc371" />
            <stop offset="0.65" stopColor="#47cf73" />
            <stop offset="1" stopColor="#3a8dde" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${gradientId})`} />
        <text x="50" y="62" textAnchor="middle" fontSize="34" fontWeight="900" fill="#fff" style={{ fontFamily: 'var(--font)' }} letterSpacing="-1">
          kids
        </text>
      </svg>
    );
  }
  const [kind, color] = id.split('-') as [Face, string];
  const bg = COLORS[color] ?? COLORS.blue!;
  const validFace: Face = ['smile', 'grin', 'wink', 'cool', 'wow'].includes(kind) ? kind : 'smile';
  return (
    <svg className={`avatar ${className}`} viewBox="0 0 100 100" role="img" aria-label={title ?? 'Profile avatar'}>
      <rect width="100" height="100" fill={bg} />
      <path d="M0 0h100v46C70 36 30 60 0 50z" fill="#fff" opacity="0.07" />
      {face(validFace)}
    </svg>
  );
}
