import type { CommandId } from '../commands/command-registry';
import { IconFrame } from '../kit/icon-frame';
import { Icon } from '../kit/icons';

export type ToolbarIconKey = CommandId | 'shortcuts' | 'more' | 'remote';

const SHEET = <path d="M13 2H5a1 1 0 0 0-1 1v18h16V9l-7-7ZM13 2v7h7" />;
const CODE = (
  <IconFrame>
    {SHEET}
    <path className="lf-icon-accent" d="m9 12-3 3 3 3m6-6 3 3-3 3" />
  </IconFrame>
);

// Familiar file conventions share the same optical grid as specialist tools.
// Small accent strokes identify the action without adding visual noise.
const TOOLBAR_ICONS: Partial<Readonly<Record<ToolbarIconKey, JSX.Element>>> = {
  'file.new': (
    <IconFrame>
      {SHEET}
      <path className="lf-icon-accent" d="M12 12v6M9 15h6" />
    </IconFrame>
  ),
  'file.open': (
    <IconFrame>
      <path d="M3 8V4h6l3 3h9v4M3 8h6l3 3h10l-3 9H4L2 8h1Z" />
      <path className="lf-icon-accent" d="M6 15h11" />
    </IconFrame>
  ),
  'file.save': (
    <IconFrame>
      <path d="M4 3h13l4 4v14H3V4a1 1 0 0 1 1-1ZM7 3v6h9V3" />
      <path className="lf-icon-accent" d="M7 21v-7h10v7M13 5v2" />
    </IconFrame>
  ),
  'file.save-as': (
    <IconFrame>
      <path d="M4 3h12l4 4v5M7 3v6h8V3M11 21H3V3M7 21v-7h5" />
      <path className="lf-icon-accent" d="m14 19 6-6 2 2-6 6-3 1 1-3Z" />
    </IconFrame>
  ),
  'file.import': CODE,
  'file.import-svg': CODE,
  'file.import-image': (
    <IconFrame>
      <path d="M13 4H3v16h18V11M3 17l5-5 4 4 3-3 6 5" />
      <circle cx="8" cy="8" r="1" />
      <path className="lf-icon-accent" d="M18 2v6M15 5h6" />
    </IconFrame>
  ),
  'tools.add-text': <Icon name="text" />,
  'tools.registration-jig': (
    <IconFrame>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <path className="lf-icon-accent" d="M7 12h10M12 7v10" />
      <circle cx="12" cy="12" r="3" />
    </IconFrame>
  ),
  'tools.camera': (
    <IconFrame>
      <path d="M3 7h4l2-3h6l2 3h4v14H3V7Z" />
      <circle cx="12" cy="13" r="4" />
      <path className="lf-icon-accent" d="M12 11a2 2 0 0 1 2 2M18 10h.5" />
    </IconFrame>
  ),
  'tools.place-board': (
    <IconFrame>
      <path d="M3 11V3h8M15 3h6v6M3 15v6h6" />
      <path className="lf-icon-accent" d="m11 10 10 5-4 1-1 5-5-11Z" />
      <path d="M7 7h4M7 11v-4" />
    </IconFrame>
  ),
  'tools.box-generator': (
    <IconFrame>
      <path d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10" />
      <path className="lf-icon-accent" d="m7.5 4.5 9 5v4" />
    </IconFrame>
  ),
  'tools.barcode': (
    <IconFrame>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7v10M11 7v10M17 7v10" />
      <path className="lf-icon-accent" d="M14 7v10" />
    </IconFrame>
  ),
  'tools.trace-image': (
    <IconFrame>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <path d="M6 16c5 0 3-8 10-8" />
      <g className="lf-icon-accent">
        <rect x="4" y="14" width="4" height="4" rx=".5" />
        <rect x="14" y="6" width="4" height="4" rx=".5" />
      </g>
    </IconFrame>
  ),
  'tools.photo-engraving': (
    <IconFrame>
      <path d="M13 3H3v18h18v-8M3 18l5-5 4 4 4-4 5 5" />
      <circle cx="7.5" cy="8" r="1.5" />
      <path className="lf-icon-accent" d="M18 2h4v5l-2 2-2-2V2ZM20 9v3M17 11l1 1M23 11l-1 1" />
    </IconFrame>
  ),
  'tools.edit-image': (
    <IconFrame>
      <path d="M14 3H3v18h9M3 18l5-5 4 4M16 12l5-5 2 2-5 5-3 1 1-3Z" />
      <circle className="lf-icon-accent" cx="8" cy="8" r="1.5" />
      <path d="M17 19h5M19.5 16.5v5" />
    </IconFrame>
  ),
  'tools.convert-to-bitmap': (
    <IconFrame>
      <path d="M3 3h7v7H3zM14 14h7v7h-7zM3 14h7v7H3z" />
      <path className="lf-icon-accent" d="M14 3h7v7h-7z" />
    </IconFrame>
  ),
  'file.save-gcode': (
    <IconFrame>
      {SHEET}
      <path className="lf-icon-accent" d="M12 12v6m-3-3 3 3 3-3" />
    </IconFrame>
  ),
  'file.inspect-gcode': (
    <IconFrame>
      <path d="M10 2v11l9 6M10 13 2 19M10 13l8-8" />
      <path className="lf-icon-accent" d="M7 5l3-3 3 3M15 19h4v-4M2 15v4h4M14 5h4v4" />
    </IconFrame>
  ),
  'window.toggle-preview': <Icon name="eye" />,
  shortcuts: (
    <IconFrame>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 9h.5m3.5 0h.5m3.5 0h.5m3.5 0h.5M6 12h.5m3.5 0h.5m3.5 0h.5m3.5 0h.5" />
      <path className="lf-icon-accent" d="M7 16h10" />
    </IconFrame>
  ),
  more: <Icon name="more" />,
  remote: (
    <IconFrame>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M10 5h4M11 19h2" />
      <path className="lf-icon-accent" d="M9 10a4 4 0 0 1 6 0m-4 2a1.5 1.5 0 0 1 2 0M12 14v.2" />
    </IconFrame>
  ),
};

export function ToolbarIcon(props: { readonly icon: ToolbarIconKey }): JSX.Element | null {
  const glyph = TOOLBAR_ICONS[props.icon];
  if (glyph === undefined) return null;
  return (
    <span className="lf-toolbar-icon" aria-hidden="true">
      {glyph}
    </span>
  );
}
