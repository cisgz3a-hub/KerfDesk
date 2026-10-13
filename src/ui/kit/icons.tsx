// KerfDesk precision icons: a 24-unit optical grid, open geometry and small
// brass details drawn from the timber-and-ivory introduction. The control
// owns the accessible name and semantic colour; these SVGs are decorative.

import { IconFrame } from './icon-frame';

export type IconName =
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up-left'
  | 'arrow-up-right'
  | 'arrow-down-left'
  | 'arrow-down-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'plus'
  | 'minus'
  | 'close'
  | 'check'
  | 'warning'
  | 'help'
  | 'download'
  | 'lock'
  | 'unlock'
  | 'panels'
  | 'more'
  | 'eye-off'
  | 'copy'
  | 'merge-down'
  | 'tutorial'
  | 'monitor'
  | 'library'
  | 'shapes'
  | 'snap'
  | 'rotate-left'
  | 'rotate-right'
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
  | 'trace-parts'
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
  | 'redo'
  | 'laser'
  | 'cnc';

const ICON_PATHS: Readonly<Record<IconName, JSX.Element>> = {
  sliders: (
    <>
      <path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11" />
      <path className="lf-icon-accent" d="M10 3.5v5M16 9.5v5M8 15.5v5" />
    </>
  ),
  layers: (
    <>
      <path className="lf-icon-plane" d="m3 7 9-4 9 4-9 4-9-4Z" />
      <path d="m3 7 9-4 9 4-9 4-9-4ZM3 12l9 4 9-4" />
      <path className="lf-icon-accent" d="m3 17 9 4 9-4" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      <circle className="lf-icon-accent" cx="12" cy="12" r="1" />
    </>
  ),
  'arrow-up': <path d="M12 21V4M6 10l6-6 6 6" />,
  'arrow-down': <path d="M12 3v17M6 14l6 6 6-6" />,
  'arrow-left': <path d="M21 12H4M10 6l-6 6 6 6" />,
  'arrow-right': <path d="M3 12h17M14 6l6 6-6 6" />,
  'arrow-up-left': <path d="M19 19 5 5M5 14V5h9" />,
  'arrow-up-right': <path d="M5 19 19 5M10 5h9v9" />,
  'arrow-down-left': <path d="M19 5 5 19M5 10v9h9" />,
  'arrow-down-right': <path d="m5 5 14 14M10 19h9v-9" />,
  'chevron-up': <path d="m6.5 15 5.5-5.5 5.5 5.5" />,
  'chevron-down': <path d="m6.5 9 5.5 5.5L17.5 9" />,
  'chevron-left': <path d="m15 6.5-5.5 5.5 5.5 5.5" />,
  'chevron-right': <path d="m9 6.5 5.5 5.5L9 17.5" />,
  plus: <path d="M12 4v16M4 12h16" />,
  minus: <path d="M4 12h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m4 12 5 5L20 6" />,
  warning: (
    <>
      <path d="M10.3 3.9a2 2 0 0 1 3.4 0l8 14.1a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3l8-14.1Z" />
      <path d="M12 8v5M12 16.5v.5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4.1 1.9c-1.1.8-1.6 1.1-1.6 2.6M12 17v.2" />
    </>
  ),
  download: (
    <>
      <path d="M4 16v5h16v-5M12 3v12" />
      <path className="lf-icon-accent" d="m7 10 5 5 5-5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path className="lf-icon-accent" d="M12 14v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.5-2" />
      <path className="lf-icon-accent" d="M12 14v3" />
    </>
  ),
  panels: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path className="lf-icon-accent" d="M9 10h12" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9 5.4a12 12 0 0 1 3-.4c6.5 0 10 7 10 7a17 17 0 0 1-3 4M6 6a20 20 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 5-1" />
      <path d="M10 10a3 3 0 0 0 4 4M3 3l18 18" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path className="lf-icon-accent" d="M16 8V3H3v13h5" />
    </>
  ),
  'merge-down': (
    <>
      <path d="M3 17h18v4H3zM12 3v10" />
      <path className="lf-icon-accent" d="m8 9 4 4 4-4M3 5h4m10 0h4" />
    </>
  ),
  tutorial: (
    <>
      <path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1ZM12 5v15" />
      <path className="lf-icon-accent" d="M5 8h3M5 12h3M16 8h3M16 12h3" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M12 16.5V21M8 21h8" />
      <path className="lf-icon-accent" d="M6 13h12" />
    </>
  ),
  library: (
    <>
      <path d="M3 4h4v17H3zM10 4h4v17h-4zM17 4l4-1 3 17-4 1-3-17Z" transform="translate(-1 0)" />
      <path className="lf-icon-accent" d="M2 8h4m3 0h4M2 17h4m3 0h4" />
    </>
  ),
  shapes: (
    <>
      <path d="m7 3 5 8H2l5-8Z" />
      <circle className="lf-icon-accent" cx="17" cy="8" r="4" />
      <rect x="5" y="15" width="8" height="7" rx="1" />
      <path d="M17 17h5m-2.5-2.5v5" />
    </>
  ),
  snap: (
    <>
      <path d="M4 3v10a8 8 0 0 0 16 0V3h-5v10a3 3 0 0 1-6 0V3H4Z" />
      <path className="lf-icon-accent" d="M4 8h5M15 8h5" />
    </>
  ),
  'rotate-left': (
    <>
      <path d="M4 9a8 8 0 1 1 1 9" />
      <path className="lf-icon-accent" d="M4 3v6h6" />
    </>
  ),
  'rotate-right': (
    <>
      <path d="M20 9a8 8 0 1 0-1 9" />
      <path className="lf-icon-accent" d="M20 3v6h-6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle className="lf-icon-accent" cx="12" cy="12" r="3" />
    </>
  ),
  'fit-bed': (
    <>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <path className="lf-icon-accent" d="M9 12h6M12 9v6" />
    </>
  ),
  'fit-selection': (
    <>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <rect className="lf-icon-accent" x="8" y="8" width="8" height="8" rx="1" />
    </>
  ),
  play: <path className="lf-icon-plane" d="m8 4 12 8-12 8V4Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <rect className="lf-icon-plane" x="5" y="5" width="14" height="14" rx="1.5" />,
  home: (
    <>
      <path d="m3 11 9-8 9 8M5.5 9.5V21h13V9.5" />
      <path className="lf-icon-accent" d="M10 21v-7h4v7" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15" />
      <path className="lf-icon-accent" d="M10 10v7M14 10v7" />
    </>
  ),
  cursor: (
    <>
      <path className="lf-icon-plane" d="M5 3v17l4.5-5 3.5 6 3-1.7-3.5-6L19 12 5 3Z" />
      <path d="M5 3v17l4.5-5 3.5 6 3-1.7-3.5-6L19 12 5 3Z" />
    </>
  ),
  'trace-parts': (
    <>
      <path d="M3 9V3h6M15 3h6v6M3 15v6h6" strokeDasharray="2.5 3" />
      <path className="lf-icon-accent" d="M11 11h8v8h-8zM17 17l5 5" />
    </>
  ),
  text: (
    <>
      <path d="M4 7V4h16v3M12 4v16" />
      <path className="lf-icon-accent" d="M8 20h8" />
    </>
  ),
  nodes: (
    <>
      <path d="M5 18C5 7 19 17 19 6M5 18V7M19 6v11" />
      <circle cx="5" cy="7" r="1.3" />
      <circle cx="19" cy="17" r="1.3" />
      <g className="lf-icon-accent">
        <rect x="3" y="16" width="4" height="4" rx="0.5" />
        <rect x="17" y="4" width="4" height="4" rx="0.5" />
      </g>
    </>
  ),
  square: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path className="lf-icon-accent" d="M4 8V4h4" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path className="lf-icon-accent" d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
    </>
  ),
  pentagon: (
    <>
      <path d="m12 3 8.5 6.2-3.3 10.1H6.8L3.5 9.2 12 3Z" />
      <path className="lf-icon-accent" d="m3.5 9.2 8.5-6.2" />
    </>
  ),
  star: (
    <path d="m12 2.7 2.8 5.9 6.5.8-4.8 4.5 1.3 6.5-5.8-3.2-5.8 3.2 1.3-6.5-4.8-4.5 6.5-.8L12 2.7Z" />
  ),
  ruler: (
    <>
      <path d="m3 16 13-13 5 5L8 21l-5-5Z" />
      <path className="lf-icon-accent" d="m7 12 2 2m2-6 2 2m2-6 2 2" />
    </>
  ),
  pen: (
    <>
      <path d="m4 20 1.5-6L17 2.5l4.5 4.5L10 18.5 4 20Z" />
      <path className="lf-icon-accent" d="m14 5.5 4.5 4.5M5.5 14l4.5 4.5" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path className="lf-icon-accent" d="M9 4v16M6 8v8" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path className="lf-icon-accent" d="M15 4v16M18 8v8" />
    </>
  ),
  undo: (
    <>
      <path d="M4 8h9a6 6 0 0 1 0 12H9" />
      <path className="lf-icon-accent" d="m9 3-5 5 5 5" />
    </>
  ),
  redo: (
    <>
      <path d="M20 8h-9a6 6 0 0 0 0 12h4" />
      <path className="lf-icon-accent" d="m15 3 5 5-5 5" />
    </>
  ),
  laser: (
    <>
      <path d="M8 2h8v7l-4 4-4-4V2ZM8 6h8M3 22h18" />
      <path className="lf-icon-accent" d="M12 13v6M7 16l1.5 1.5M17 16l-1.5 1.5M9 20h6" />
    </>
  ),
  cnc: (
    <>
      <rect x="8" y="2" width="8" height="8" rx="1" />
      <path d="M8 6h8M10 10v10h4V10M3 22h18" />
      <path className="lf-icon-accent" d="m10 14 4-2m-4 6 4-2" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { readonly name: IconName; readonly size?: number }) {
  return <IconFrame size={size}>{ICON_PATHS[name]}</IconFrame>;
}
