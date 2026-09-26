// Line-mode perforation and overcut at compile time (ADR-415). Perforation
// runs after kerf and tabs, so it dashes the path the beam would otherwise cut
// continuously, and tab gaps stay gaps. The dashes are ordinary open segments,
// which every output (GRBL, Marlin, Smoothieware, Ruida), the preview and the
// estimate already handle. Overcut is only recorded on the group here; the
// final pass applies it (cut-pass-segments.ts).

import { perforatePolyline } from '../geometry/perforation';
import type { LayerOperationSettings } from '../scene';
import type { CutGroup, CutSegment } from './job';
import { overcutMmFor, perforationPatternFor } from './operation-cut-extras';

export function perforateLineSegments(
  segments: ReadonlyArray<CutSegment>,
  settings: LayerOperationSettings,
): ReadonlyArray<CutSegment> {
  const pattern = perforationPatternFor(settings);
  if (pattern === null) return segments;
  return segments.flatMap((segment) =>
    perforatePolyline({ points: segment.polyline, closed: segment.closed }, pattern).map(
      (dash) => ({ polyline: dash.points, closed: false }),
    ),
  );
}

/** The group field for the operation's overcut; empty when nothing is closed. */
export function lineOvercutFields(
  settings: LayerOperationSettings,
  segments: ReadonlyArray<CutSegment>,
): Pick<CutGroup, 'finalPassOvercutMm'> {
  const overcutMm = overcutMmFor(settings);
  return overcutMm > 0 && segments.some((segment) => segment.closed)
    ? { finalPassOvercutMm: overcutMm }
    : {};
}
