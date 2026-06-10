// icons — hand-rolled 16px inline SVG set (ADR-047; zero dependencies).
//
// stroke="currentColor" everywhere so icons inherit button text color,
// including hover and :disabled states, for free. aria-hidden: icons are
// decorative — the OWNING control carries the accessible name (IconButton
// requires a label).

export type IconName =
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'plus'
  | 'minus'
  | 'close'
  | 'eye'
  | 'fit-bed'
  | 'fit-selection'
  | 'play'
  | 'pause'
  | 'stop'
  | 'home'
  | 'trash';

const ICON_PATHS: Readonly<Record<IconName, JSX.Element>> = {
  'arrow-up': <path d="M8 13V3M4 7l4-4 4 4" />,
  'arrow-down': <path d="M8 3v10M4 9l4 4 4-4" />,
  'arrow-left': <path d="M13 8H3M7 4L3 8l4 4" />,
  'arrow-right': <path d="M3 8h10M9 4l4 4-4 4" />,
  'chevron-up': <path d="M4 10l4-4 4 4" />,
  'chevron-down': <path d="M4 6l4 4 4-4" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  eye: (
    <>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  'fit-bed': (
    <>
      <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
    </>
  ),
  'fit-selection': (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5" />
    </>
  ),
  play: <path d="M5 3.5v9l7-4.5-7-4.5Z" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" />,
  home: <path d="M2.5 8 8 2.5 13.5 8M4.5 7v6.5h7V7" />,
  trash: <path d="M2.5 4.5h11M6.5 4.5v-2h3v2M4 4.5l.7 9h6.6l.7-9M6.5 7v4M9.5 7v4" />,
};

export function Icon({ name, size = 16 }: { readonly name: IconName; readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
