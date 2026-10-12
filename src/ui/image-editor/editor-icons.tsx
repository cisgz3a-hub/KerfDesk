import { IconFrame } from '../kit/icon-frame';
import { Icon } from '../kit/icons';
import type { EditorTool } from './editor-session';

const ICONS: Readonly<Record<EditorTool['kind'], JSX.Element>> = {
  brush: (
    <IconFrame>
      <path d="m11 12 8-9a2 2 0 0 1 3 3l-9 8M9 12c-5 0-3 6-7 8 5 2 11-1 9-6l-2-2Z" />
      <path className="lf-icon-accent" d="m14 9 3 3M5 19l3-3" />
    </IconFrame>
  ),
  pencil: <Icon name="pen" />,
  eraser: (
    <IconFrame>
      <path d="m3 14 11-11 8 8-10 10H9l-6-6v-1ZM13 21h8" />
      <path className="lf-icon-accent" d="m8 9 8 8" />
    </IconFrame>
  ),
  line: (
    <IconFrame>
      <path d="m5 19 14-14" />
      <circle className="lf-icon-accent" cx="4" cy="20" r="1.5" />
      <circle className="lf-icon-accent" cx="20" cy="4" r="1.5" />
    </IconFrame>
  ),
  marquee: (
    <IconFrame>
      <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="3 3" />
      <path className="lf-icon-accent" d="M3 7V3h4" />
    </IconFrame>
  ),
  lasso: (
    <IconFrame>
      <path d="M9 17c-4 0-7-2.7-7-6S6.3 4 12 4s10 3.7 10 7-4 6-9 6M11 18c-1 3 1 4 3 4" />
      <path className="lf-icon-accent" d="M9 17c0-2 4-3 4-1s-4 3-4 1Z" />
    </IconFrame>
  ),
  wand: (
    <IconFrame>
      <path d="m3 19 13-13 3 3L6 22l-3-3Zm10-10 3 3" />
      <path className="lf-icon-accent" d="M6 2v4M4 4h4M19 2v3M21 13v4M19 15h4" />
    </IconFrame>
  ),
  bucket: (
    <IconFrame>
      <path d="m3 11 9-9 8 8-9 9-8-8ZM3 11h17M8 1l6 6" />
      <path className="lf-icon-accent" d="M20 15s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Z" />
    </IconFrame>
  ),
  gradient: (
    <IconFrame>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <path d="M6 6v12M9 6v12" />
      <path d="M12 6v12" opacity=".65" />
      <path className="lf-icon-accent" d="M15 6v12" />
      <path d="M18 6v12" opacity=".3" />
    </IconFrame>
  ),
  clone: (
    <IconFrame>
      <path d="M8 6a4 4 0 1 1 8 0c0 3-2 4-2 7h-4c0-3-2-4-2-7ZM10 13H6l-3 5h18l-3-5h-4" />
      <path className="lf-icon-accent" d="M5 21h14" />
    </IconFrame>
  ),
  heal: (
    <IconFrame>
      <path d="m4 12 8-8a5.7 5.7 0 0 1 8 8l-8 8a5.7 5.7 0 0 1-8-8ZM7 9l8 8M9 7l8 8" />
      <path className="lf-icon-accent" d="m10 11 .1.1m3.8 1.8.1.1m-2.9.9.1.1m1.8-3.9.1.1" />
    </IconFrame>
  ),
  crop: (
    <IconFrame>
      <path d="M6 2v16h16M2 6h16v16" />
      <path className="lf-icon-accent" d="M10 10h4v4" />
    </IconFrame>
  ),
  move: (
    <IconFrame>
      <path d="M12 2v20M2 12h20m-13-7 3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3" />
    </IconFrame>
  ),
};

export function EditorToolIcon(props: { readonly kind: EditorTool['kind'] }): JSX.Element {
  return (
    <span className="lf-toolbar-icon" aria-hidden="true">
      {ICONS[props.kind]}
    </span>
  );
}
