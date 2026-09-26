import { useId } from 'react';
import './Logo.css';

/** Red wordmark on a gentle "cinema screen" curve. */
export function Logo({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const id = useId().replace(/:/g, '');
  if (compact) return <LogoMark className={className} />;
  return (
    <svg className={`logo ${className}`} viewBox="0 0 420 64" role="img" aria-label="Home Blockbuster">
      <defs>
        <path id={`arc-${id}`} d="M 4 58 Q 210 46 416 58" />
      </defs>
      <text className="logo__text" fontSize="62">
        <textPath href={`#arc-${id}`} textLength="412" lengthAdjust="spacingAndGlyphs">
          HOME BLOCKBUSTER
        </textPath>
      </text>
    </svg>
  );
}

export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 64 64" role="img" aria-label="Home Blockbuster">
      <path
        fill="#E50914"
        fillRule="evenodd"
        d="M17 8h17c8.2 0 12.6 4.4 12.6 11 0 4.4-2 7.7-5.6 9.5 4.8 1.7 7.7 5.6 7.7 11 0 8.4-5.2 16.5-15 16.5H17V8zm11 8.6v11h4.4c3.1 0 4.7-2 4.7-5.5s-1.6-5.5-4.7-5.5H28zm0 19v12h5.4c3.4 0 5.1-2.2 5.1-6s-1.7-6-5.1-6H28z"
      />
    </svg>
  );
}
