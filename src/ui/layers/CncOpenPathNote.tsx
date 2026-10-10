// CncOpenPathNote — per-layer advisory under a closed-only cut type. Count
// open contours even when closed artwork on the same operation still cuts.
// An all-open vector operation without assigned relief retains the no-toolpath explanation.
//
// Which cut types those are is measured against the compiler, not assumed —
// core/cnc/closed-contour-cut-types.ts and its test. V-carve, Pocket and Drill
// each emit zero motion from open strokes; the profile and engrave families
// still emit, so they are deliberately silent here.
//
// Text only — informs, never gates (rule 7). Every cut type stays selectable
// for every layer, and nothing about Frame or Start changes.
//
// The panel's 300 ms F-A7 debounce cadence: the check collects the layer's
// polylines, so it runs once the scene settles rather than on every store commit.

import { useEffect, useState } from 'react';
// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json pins it at 67) and may only shrink.
import { cutTypeNeedsClosedContours } from '../../core/cnc/closed-contour-cut-types';
import {
  cutTypeLabel,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { cncNoteContours } from './cnc-note-contours';

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
  const [openCount, setOpenCount] = useState(0);
  const [geometryIssue, setGeometryIssue] = useState<string | null>(null);
  const needsClosed =
    machine?.kind === 'cnc' && layer.output && cutTypeNeedsClosedContours(settings.cutType);

  useEffect(() => {
    if (!needsClosed) {
      setIsAllOpen(false);
      setOpenCount(0);
      setGeometryIssue(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const result = cncNoteContours(objects, layer, device);
      const polylines = result.polylines;
      setGeometryIssue(result.geometryIssue);
      const count = polylines.filter((polyline) => !polyline.closed).length;
      setOpenCount(count);
      // A closed but degenerate outline is not an open contour.
      const hasRelief = objects.some(
        (object) => object.kind === 'relief' && sceneObjectUsesOperation(object, layer),
      );
      // Relief output is independent of the vector cut type. Do not infer the
      // entire operation's lack of motion from its vector contours alone.
      setIsAllOpen(count > 0 && count === polylines.length && !hasRelief);
    }, NOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [needsClosed, objects, layer, device]);

  if (geometryIssue !== null)
    return (
      <p role="note" style={noteStyle}>
        {geometryIssue}
      </p>
    );
  if (openCount === 0) return null;
  if (!isAllOpen)
    return (
      <p role="note" style={noteStyle}>
        {openCount} open contour{openCount === 1 ? ' is' : 's are'} omitted from this layer. For
        vector artwork, {cutTypeLabel(settings.cutType)} works on closed outlines only. Use “Engrave
        (trace path)” or “On path” for open strokes, or close the shapes.
      </p>
    );
  return (
    <p role="note" style={noteStyle}>
      Every shape on this layer is an open path. {openCount} open contour
      {openCount === 1 ? ' is' : 's are'} omitted. {cutTypeLabel(settings.cutType)} works on closed
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
