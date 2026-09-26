import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Svg({ title, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" stroke="none" d="M6 4.3v15.4a1.1 1.1 0 0 0 1.68.93l12.3-7.7a1.1 1.1 0 0 0 0-1.86L7.68 3.37A1.1 1.1 0 0 0 6 4.3z" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="4.6" height="17" rx="1" fill="currentColor" stroke="none" />
    <rect x="14.4" y="3.5" width="4.6" height="17" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.6" strokeWidth="2" />
    <path d="M12 10.6v6.6" strokeWidth="2.3" />
    <circle cx="12" cy="7.2" r="1.35" fill="currentColor" stroke="none" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5v15M4.5 12h15" strokeWidth="2.4" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12.5l5 5 10-11" strokeWidth="2.4" />
  </Svg>
);

const thumb = 'M7.2 10.4v9.9H3.6v-9.9h3.6zm0 0l4.1-6.9c.4-.7 1.2-1 2-.8 1 .3 1.6 1.3 1.4 2.3l-.8 3.9h5c1.3 0 2.3 1.2 2 2.5l-1.7 7.5a2 2 0 0 1-2 1.5H7.2';

export const ThumbUpIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path d={thumb} strokeWidth="1.8" fill={filled ? 'currentColor' : 'none'} />
  </Svg>
);

export const ThumbDownIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path d={thumb} strokeWidth="1.8" fill={filled ? 'currentColor' : 'none'} transform="rotate(180 12 12)" />
  </Svg>
);

export const DoubleThumbIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <g transform="translate(-1.6 3.4) scale(0.78)">
      <path d={thumb} strokeWidth="2.2" fill={filled ? 'currentColor' : 'none'} />
    </g>
    <g transform="translate(6.4 -0.6) scale(0.78)">
      <path d={thumb} strokeWidth="2.2" fill={filled ? 'currentColor' : 'var(--thumb-bg, #232323)'} />
    </g>
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 8.5l7 7 7-7" strokeWidth="2.4" />
  </Svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 15.5l7-7 7 7" strokeWidth="2.4" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 4.5L8 12l7.5 7.5" strokeWidth="2.4" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 4.5L16 12l-7.5 7.5" strokeWidth="2.4" />
  </Svg>
);

export const CaretDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 9.5h11L12 15.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6.6" strokeWidth="2.2" />
    <path d="M15.6 15.6L21 21" strokeWidth="2.4" />
  </Svg>
);

export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2a6 6 0 0 0-6 6v4.1l-1.7 3.1a.9.9 0 0 0 .8 1.3h13.8a.9.9 0 0 0 .8-1.3L18 13.3V9.2a6 6 0 0 0-6-6z" strokeWidth="2" />
    <path d="M9.6 20.4a2.6 2.6 0 0 0 4.8 0" strokeWidth="2" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" strokeWidth="2.4" />
  </Svg>
);

const speaker = 'M3 9.3h3.9L12 4.8v14.4l-5.1-4.5H3z';

export const VolumeHighIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d={speaker} fill="currentColor" strokeWidth="1.5" />
    <path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8M18.2 5.8a8.8 8.8 0 0 1 0 12.4" strokeWidth="2" />
  </Svg>
);

export const VolumeLowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d={speaker} fill="currentColor" strokeWidth="1.5" />
    <path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8" strokeWidth="2" />
  </Svg>
);

export const VolumeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d={speaker} fill="currentColor" strokeWidth="1.5" />
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" strokeWidth="2" />
  </Svg>
);

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12H4.8M11 5l-7 7 7 7" strokeWidth="2.4" />
  </Svg>
);

function SkipIcon({ forward, ...p }: IconProps & { forward?: boolean }) {
  return (
    <Svg {...p}>
      <g transform={forward ? 'matrix(-1 0 0 1 24 0)' : undefined}>
        <path d="M5.2 8.6A8 8 0 1 0 12 4.2H9.8" strokeWidth="2" />
        <path d="M11.9 1.3L9 4.2l2.9 2.9" strokeWidth="2" />
      </g>
      <text
        x="12.2"
        y="15.9"
        fontSize="7.6"
        fontWeight="800"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        10
      </text>
    </Svg>
  );
}

export const Rewind10Icon = (p: IconProps) => <SkipIcon {...p} />;
export const Forward10Icon = (p: IconProps) => <SkipIcon forward {...p} />;

export const SubtitlesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.5h18v11.5H9.4L5 19.8V16H3z" strokeWidth="2" />
    <path d="M7 8.6h4.2M13.6 8.6H17M7 12h7M16.6 12h.4" strokeWidth="2" />
  </Svg>
);

export const EpisodesIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="8" width="14.5" height="11.5" rx="1.2" strokeWidth="2" />
    <path d="M6.5 4.5h14v11" strokeWidth="2" />
  </Svg>
);

export const NextEpisodeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 4.6v14.8a.9.9 0 0 0 1.4.75l10.4-7.4a.9.9 0 0 0 0-1.5L5.6 3.85a.9.9 0 0 0-1.4.75z" fill="currentColor" stroke="none" />
    <rect x="17.5" y="4" width="3" height="16" rx="0.8" fill="currentColor" stroke="none" />
  </Svg>
);

export const SpeedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.6 17.5a9 9 0 1 1 16.8 0" strokeWidth="2" />
    <path d="M12 15l4.4-5.4" strokeWidth="2.2" />
    <circle cx="12" cy="15" r="1.7" fill="currentColor" stroke="none" />
  </Svg>
);

export const FullscreenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9V3.5H9M15 3.5h5.5V9M20.5 15v5.5H15M9 20.5H3.5V15" strokeWidth="2.2" />
  </Svg>
);

export const ExitFullscreenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3.5V9H3.5M20.5 9H15V3.5M15 20.5V15h5.5M3.5 15H9v5.5" strokeWidth="2.2" />
  </Svg>
);

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4.2L19.3 8.9a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8z" strokeWidth="2" />
    <path d="M13.6 6.2l4.2 4.2" strokeWidth="2" />
  </Svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.4l2 2.2h8.6A1.5 1.5 0 0 1 21 8.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" strokeWidth="2" />
  </Svg>
);

export const FilmIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2" strokeWidth="2" />
    <path d="M7.5 3.5v17M16.5 3.5v17M3 8h4.5M3 12h4.5M3 16h4.5M16.5 8H21M16.5 12H21M16.5 16H21" strokeWidth="1.6" />
  </Svg>
);

export const TvIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="13" rx="2" strokeWidth="2" />
    <path d="M8.5 2.5L12 6l3.5-3.5M8 22h8" strokeWidth="2" />
  </Svg>
);

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h9M19 6h1M4 12h3M11 12h9M4 18h11M19 18h1" strokeWidth="2" />
    <circle cx="16" cy="6" r="2.2" strokeWidth="2" />
    <circle cx="9" cy="12" r="2.2" strokeWidth="2" />
    <circle cx="17" cy="18" r="2.2" strokeWidth="2" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11.5a8 8 0 1 0-2.4 5.8" strokeWidth="2.2" />
    <path d="M20.3 4.5v7h-7" strokeWidth="2.2" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 3.5h4M6.2 7l1 13h9.6l1-13M10 11v5M14 11v5" strokeWidth="2" />
  </Svg>
);

export const DriveIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="7" width="19" height="10.5" rx="2" strokeWidth="2" />
    <circle cx="17" cy="12.25" r="1.3" fill="currentColor" stroke="none" />
    <path d="M6 12.25h6" strokeWidth="2" />
  </Svg>
);

export const ServerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="7.5" rx="1.6" strokeWidth="2" />
    <rect x="3" y="13.5" width="18" height="7.5" rx="1.6" strokeWidth="2" />
    <path d="M7 6.75h.01M7 17.25h.01M11 6.75h6M11 17.25h6" strokeWidth="2.4" />
  </Svg>
);

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 10.8L12 4l8.5 6.8V20a1 1 0 0 1-1 1H15v-6.2H9V21H4.5a1 1 0 0 1-1-1z" strokeWidth="2" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" strokeWidth="2" />
    <path d="M4 20.5c1.2-3.6 4.2-5.5 8-5.5s6.8 1.9 8 5.5" strokeWidth="2" />
  </Svg>
);

export const LogoutIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h8M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" strokeWidth="2" />
  </Svg>
);

export const HelpIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" strokeWidth="2" />
    <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.3-2.6 4" strokeWidth="2" />
    <circle cx="12" cy="17.4" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const ReplayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4" strokeWidth="2.2" />
    <path d="M6.5 2.8v4.4h4.4" strokeWidth="2.2" />
  </Svg>
);

export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l9.5 16.5h-19z" strokeWidth="2" />
    <path d="M12 10v4.5" strokeWidth="2.2" />
    <circle cx="12" cy="17.4" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" strokeWidth="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" strokeWidth="2" />
  </Svg>
);

export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeWidth="2" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l9 4.8-9 4.8-9-4.8z" strokeWidth="2" />
    <path d="M3 12.3l9 4.8 9-4.8M3 16.3l9 4.8 9-4.8" strokeWidth="2" />
  </Svg>
);
