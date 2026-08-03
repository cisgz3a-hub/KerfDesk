// CncVCarveOpenPathNote — per-layer advisory under the V-carve cut type: fires
// when nothing on the layer is a closed shape. That is exactly the case where
// V-carve compiles to no toolpath at all, the emitted file carries only its
// provenance header, and the operator meets an empty 3D view with no
// explanation. Catching it here means it is caught before compile.
//
// Text only — informs, never gates (rule 7).
//
// Same 300 ms debounce as CncThinDetailNote (the panel's F-A7 cadence): the
// check collects the layer's polylines, so it runs once the scene settles
// rather than on every store commit.

import { useEffect, useState } from 'react';
// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json pins it at 67) and may only shrink.
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { hasVCarvableContour } from '../../core/cnc/vcarve-carvable-contours';
import type { CncLayerSettings, Layer } from '../../core/scene';
import { useStore } from '../state';

const NOTE_DEBOUNCE_MS = 300;

export function CncVCarveOpenPathNote(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
}): JSX.Element | null {
  const { layer, settings } = props;
  const objects = useStore((s) => s.project.scene.objects);
  const device = useStore((s) => s.project.device);
  const machine = useStore((s) => s.project.machine);
  const [isAllOpen, setIsAllOpen] = useState(false);
  const isVCarve = machine?.kind === 'cnc' && settings.cutType === 'v-carve';

  useEffect(() => {
    if (!isVCarve) {
      setIsAllOpen(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const polylines = collectLayerPolylines(objects, layer, device);
      // An empty layer is a different (and obvious) state; only artwork that
      // exists but cannot be carved is worth interrupting the operator for.
      setIsAllOpen(polylines.length > 0 && !hasVCarvableContour(polylines));
    }, NOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isVCarve, objects, layer, device]);

  if (!isAllOpen) return null;
  return (
    <p role="note" style={noteStyle}>
      Every shape on this layer is an open path. V-carve carves closed outlines only, so this layer
      produces no toolpath and the job comes out empty. Single-line fonts and traced centerlines are
      open by nature — cut them with “Engrave (trace path)” or “On path”, or close the shapes.
    </p>
  );
}

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-warning-fg)',
  margin: '4px 0 6px 0',
};
