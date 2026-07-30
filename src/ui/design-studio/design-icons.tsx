// Lucide icons for the Design Studio tool rails (ADR-268, DS-2) — the same
// pinned lucide-static assets the main toolbar and Image Studio use, keyed by
// design tool. Kept local rather than added to src/ui/kit/icons.tsx so the
// shared kit does not grow a rail's worth of glyphs (the Image Studio
// editor-icons precedent).

import arc from 'lucide-static/icons/spline.svg?raw';
import array from 'lucide-static/icons/grid-3x3.svg?raw';
import boolean from 'lucide-static/icons/combine.svg?raw';
import chamfer from 'lucide-static/icons/git-compare-arrows.svg?raw';
import circle from 'lucide-static/icons/circle.svg?raw';
import dimension from 'lucide-static/icons/ruler.svg?raw';
import extend from 'lucide-static/icons/chevrons-left-right.svg?raw';
import fillet from 'lucide-static/icons/radius.svg?raw';
import line from 'lucide-static/icons/minus.svg?raw';
import mirror from 'lucide-static/icons/flip-horizontal.svg?raw';
import node from 'lucide-static/icons/waypoints.svg?raw';
import offset from 'lucide-static/icons/move-diagonal-2.svg?raw';
import path from 'lucide-static/icons/pen-tool.svg?raw';
import polygon from 'lucide-static/icons/pentagon.svg?raw';
import rect from 'lucide-static/icons/square.svg?raw';
import select from 'lucide-static/icons/mouse-pointer-2.svg?raw';
import trim from 'lucide-static/icons/scissors.svg?raw';
import type { DesignToolKind } from './design-tool';

const ICONS: Readonly<Record<DesignToolKind, string>> = {
  select,
  node,
  line,
  path,
  rect,
  circle,
  arc,
  polygon,
  dimension,
  trim,
  extend,
  fillet,
  chamfer,
  offset,
  mirror,
  array,
  boolean,
};

export function DesignToolIcon(props: { readonly kind: DesignToolKind }): JSX.Element {
  // Every string is a pinned lucide-static build asset, never user markup.
  return (
    <span
      className="lf-toolbar-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[props.kind] }}
    />
  );
}
