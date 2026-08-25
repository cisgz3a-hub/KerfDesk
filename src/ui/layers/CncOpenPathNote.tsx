// CncOpenPathNote — per-layer advisory under the cut type: fires when nothing
// on the layer is a closed shape AND the chosen cut type needs one. That is
// exactly the case where the layer compiles to no toolpath at all, the emitted
// file carries only its provenance header, and the operator meets an empty 3D
// view with no explanation. Catching it here means it is caught before compile.
//
// Which cut types those are is measured against the compiler, not assumed —
// core/cnc/closed-contour-cut-types.ts and its test. V-carve, Pocket and Drill
// each emit zero motion from open strokes; the profile and engrave families
// still emit, so they are deliberately silent here.
//
// Text only — informs, never gates (rule 7). Every cut type stays selectable
// for every layer, and nothing about Frame or Start changes.
//
// Same 300 ms debounce as CncThinDetailNote (the panel's F-A7 cadence): the
// check collects the layer's polylines, so it runs once the scene settles
// rather than on every store commit.

import { useEffect, useState } from 'react';
// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json pins it at 67) and may only shrink.
import { cutTypeNeedsClosedContours } from '../../core/cnc/closed-contour-cut-types';
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { hasVCarvableContour } from '../../core/cnc/vcarve-carvable-contours';
import { cutTypeLabel, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';

const NOTE_DEBOUNCE_MS = 300;

export function CncOpenPathNote(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
}): JSX.Element | null {
  const { layer, settings } = props;
  const objects = useStore((s) => s.project.scene.objects);
  const device = useStore((s) => s.project.device);
  const machine = useStore((s) => s.project.machine);
  const [isAllOpen, setIsAllOpen] = useState(false);
  const needsClosed = machine?.kind === 'cnc' && cutTypeNeedsClosedContours(settings.cutType);

  useEffect(() => {
    if (!needsClosed) {
      setIsAllOpen(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const polylines = collectLayerPolylines(objects, layer, device);
      // An empty layer is a different (and obvious) state; only artwork that
      // exists but cannot be cut is worth interrupting the operator for.
      setIsAllOpen(polylines.length > 0 && !hasVCarvableContour(polylines));
    }, NOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [needsClosed, objects, layer, device]);

  if (!isAllOpen) return null;
  return (
    <p role="note" style={noteStyle}>
      Every shape on this layer is an open path. {cutTypeLabel(settings.cutType)} works on closed
      outlines only, so this layer contributes no toolpath. Single-line fonts and traced centerlines
      are open by nature — cut them with “Engrave (trace path)” or “On path”, or close the shapes.
    </p>
  );
}

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-warning-fg)',
  margin: '4px 0 6px 0',
};
