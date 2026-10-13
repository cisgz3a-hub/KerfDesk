import { IconFrame } from '../kit/icon-frame';
import { Icon } from '../kit/icons';
import type { DesignToolKind } from './design-tool';

// Geometry tools show the operation itself: construction lines stay neutral,
// with the editable edge or control point picked out in warm brass.
const ICONS: Readonly<Record<DesignToolKind, JSX.Element>> = {
  select: <Icon name="cursor" />,
  node: <Icon name="nodes" />,
  line: (
    <IconFrame>
      <path d="m6 18 12-12" />
      <g className="lf-icon-accent">
        <rect x="3" y="16" width="4" height="4" rx=".5" />
        <rect x="17" y="4" width="4" height="4" rx=".5" />
      </g>
    </IconFrame>
  ),
  path: (
    <IconFrame>
      <path d="m4 18 5-11 10 8" />
      <g className="lf-icon-accent">
        <rect x="2" y="16" width="4" height="4" rx=".5" />
        <rect x="7" y="5" width="4" height="4" rx=".5" />
        <rect x="17" y="13" width="4" height="4" rx=".5" />
      </g>
    </IconFrame>
  ),
  rect: <Icon name="square" />,
  circle: <Icon name="circle" />,
  arc: (
    <IconFrame>
      <path d="M5 19A14 14 0 0 1 19 5" />
      <path className="lf-icon-accent" d="M3 19h4M5 17v4M17 5h4M19 3v4" />
      <path d="M12 19h7v-7" strokeDasharray="2 3" />
    </IconFrame>
  ),
  polygon: <Icon name="pentagon" />,
  dimension: (
    <IconFrame>
      <path d="M3 5v14M21 5v14M3 12h18" />
      <path className="lf-icon-accent" d="m7 8-4 4 4 4m10-8 4 4-4 4" />
    </IconFrame>
  ),
  trim: (
    <IconFrame>
      <path d="M3 8h18M8 3v18" />
      <path className="lf-icon-accent" d="m13 15 7 7m-7 0 7-7" />
      <path d="m10 10 3 3" strokeDasharray="1 2" />
    </IconFrame>
  ),
  extend: (
    <IconFrame>
      <path d="M3 17h7M20 3v18" />
      <path className="lf-icon-accent" d="M10 17h10m-4-4 4 4-4 4" />
      <path d="M3 7h9" strokeDasharray="2 3" />
    </IconFrame>
  ),
  fillet: (
    <IconFrame>
      <path d="M4 21V11M13 3h8M4 8V3h5" />
      <path className="lf-icon-accent" d="M4 11a8 8 0 0 1 8-8" />
      <path d="m12 12 6 6" strokeDasharray="2 3" />
    </IconFrame>
  ),
  chamfer: (
    <IconFrame>
      <path d="M4 21V11M14 3h7M4 7V3h5" />
      <path className="lf-icon-accent" d="m4 11 8-8" />
      <path d="m12 12 6 6" strokeDasharray="2 3" />
    </IconFrame>
  ),
  offset: (
    <IconFrame>
      <path d="M3 21V3h18M9 21V9h12" />
      <path className="lf-icon-accent" d="m13 19 6-6m-6 0h6v6" />
    </IconFrame>
  ),
  mirror: (
    <IconFrame>
      <path d="M12 2v20" strokeDasharray="2 3" />
      <path d="m3 18 5-12v12H3Z" />
      <path className="lf-icon-accent" d="m21 18-5-12v12h5Z" />
    </IconFrame>
  ),
  array: (
    <IconFrame>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="15" width="6" height="6" rx="1" />
      <rect className="lf-icon-accent" x="15" y="15" width="6" height="6" rx="1" />
    </IconFrame>
  ),
  boolean: (
    <IconFrame>
      <path d="M15 9V3H3v12h6M9 15v6h12V9h-6" />
      <path className="lf-icon-accent" d="M9 9h6v6H9z" />
    </IconFrame>
  ),
};

export function DesignToolIcon(props: { readonly kind: DesignToolKind }): JSX.Element {
  return (
    <span className="lf-toolbar-icon" aria-hidden="true">
      {ICONS[props.kind]}
    </span>
  );
}
