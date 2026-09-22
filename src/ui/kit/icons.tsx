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
  | 'chevron-left'
  | 'chevron-right'
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
  | 'trash'
  | 'cursor'
  | 'text'
  | 'nodes'
  | 'square'
  | 'circle'
  | 'pentagon'
  | 'star'
  | 'ruler'
  | 'pen'
  | 'crosshair'
  | 'layers'
  | 'sliders'
  | 'panel-left'
  | 'panel-right'
  | 'undo'
  | 'redo';

const ICON_PATHS: Readonly<Record<IconName, JSX.Element>> = {
  sliders: (
    <>
      <path d="M2 4h3m4 0h5M2 12h6m4 0h2M2 8h8m4 0h0" />
      <path d="M6 2v4M11 6v4M9 10v4" />
    </>
  ),
  layers: (
    <>
      <path d="m1.5 5 6.5-3.5L14.5 5 8 8.5 1.5 5Z" />
      <path d="m1.5 8 6.5 3.5L14.5 8M1.5 11 8 14.5 14.5 11" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
    </>
  ),
  'arrow-up': <path d="M8 13V3M4 7l4-4 4 4" />,
  'arrow-down': <path d="M8 3v10M4 9l4 4 4-4" />,
  'arrow-left': <path d="M13 8H3M7 4L3 8l4 4" />,
  'arrow-right': <path d="M3 8h10M9 4l4 4-4 4" />,
  'chevron-up': <path d="M4 10l4-4 4 4" />,
  'chevron-down': <path d="M4 6l4 4 4-4" />,
  'chevron-left': <path d="M10 4 6 8l4 4" />,
  'chevron-right': <path d="m6 4 4 4-4 4" />,
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
  cursor: <path d="M4 3l8 4.5-3.3 1L11 13l-1.7.8-2.3-4.5L4 11.5V3Z" />,
  text: <path d="M3 5V3h10v2M8 3v10M5 13h6" />,
  nodes: (
    <>
      <path d="M3 12C3 5 13 11 13 4" />
      <rect x="1.5" y="11.5" width="3" height="3" rx="0.7" />
      <rect x="11.5" y="1.5" width="3" height="3" rx="0.7" />
    </>
  ),
  square: <rect x="3" y="3" width="10" height="10" rx="1" />,
  circle: <circle cx="8" cy="8" r="5.5" />,
  pentagon: <path d="M8 2.5l5.2 3.8-2 6.2H4.8l-2-6.2L8 2.5Z" />,
  star: <path d="M8 2.3l1.6 3.5 3.8.4-2.8 2.6.8 3.8L8 10.7l-3.4 1.9.8-3.8-2.8-2.6 3.8-.4L8 2.3Z" />,
  ruler: (
    <>
      <path d="M2.5 11.5l9-9 2 2-9 9-2-2Z" />
      <path d="M5 9l1 1M7 7l1 1M9 5l1 1" />
    </>
  ),
  pen: <path d="M3 13l1-3 6-6 2 2-6 6-3 1Z" />,
  // Side-panel toggles: an app-window rectangle with a divider marking the left
  // (Layers) or right (Machine) rail — the standard "toggle this sidebar" glyph.
  'panel-left': (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M10 3v10" />
    </>
  ),
  // Edit history: an arrow leaving the head and curving back on itself. The
  // two are mirror images so the pair reads as one axis at canvas size.
  undo: (
    <>
      <path d="M3 8h6.5a3 3 0 0 1 0 6H6" />
      <path d="M6.5 4.5 3 8l3.5 3.5" />
    </>
  ),
  redo: (
    <>
      <path d="M13 8H6.5a3 3 0 0 0 0 6H10" />
      <path d="M9.5 4.5 13 8l-3.5 3.5" />
    </>
  ),
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
