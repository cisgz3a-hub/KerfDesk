// Lucide icons for the Image Studio tool rail (ADR-242, PP-C) — the same
// pinned lucide-static assets the main toolbar uses, keyed by editor tool.

import blend from 'lucide-static/icons/blend.svg?raw';
import brush from 'lucide-static/icons/brush.svg?raw';
import crop from 'lucide-static/icons/crop.svg?raw';
import eraser from 'lucide-static/icons/eraser.svg?raw';
import lasso from 'lucide-static/icons/lasso.svg?raw';
import move from 'lucide-static/icons/move.svg?raw';
import paintBucket from 'lucide-static/icons/paint-bucket.svg?raw';
import pencil from 'lucide-static/icons/pencil.svg?raw';
import slash from 'lucide-static/icons/slash.svg?raw';
import squareDashed from 'lucide-static/icons/square-dashed.svg?raw';
import wand from 'lucide-static/icons/wand.svg?raw';
import type { EditorTool } from './editor-session';

const ICONS: Readonly<Record<EditorTool['kind'], string>> = {
  brush,
  pencil,
  eraser,
  line: slash,
  marquee: squareDashed,
  lasso,
  wand,
  bucket: paintBucket,
  gradient: blend,
  crop,
  move,
};

export function EditorToolIcon(props: { readonly kind: EditorTool['kind'] }): JSX.Element {
  // Every string is a pinned lucide-static build asset, never user markup.
  return (
    <span
      className="lf-toolbar-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[props.kind] }}
    />
  );
}
