// Line-mode perforation, overcut and laser leads at compile time (ADR-415,
// ADR-626). Perforation
// runs after kerf and tabs, so it dashes the path the beam would otherwise cut
// continuously, and tab gaps stay gaps. The dashes are ordinary open segments,
// which every output (GRBL, Marlin, Smoothieware, Ruida), the preview and the
// estimate already handle. Overcut is only recorded on the group here; the
// final pass applies it (cut-pass-segments.ts). Leads are only recorded too:
// preparation adds them once the planner has chosen each contour's start
// (apply-laser-leads.ts).

import { perforatePolyline } from '../geometry/perforation';
import type { LayerOperationSettings } from '../scene';
import type { CutGroup, CutSegment, JobDiagnostic } from './job';
import { laserLeadSpecFor } from './laser-lead-settings';
import { overcutMmFor, perforationPatternFor } from './operation-cut-extras';

export function perforateLineSegments(
  segments: ReadonlyArray<CutSegment>,
  settings: LayerOperationSettings,
): ReadonlyArray<CutSegment> {
  const pattern = perforationPatternFor(settings);
  if (pattern === null) return segments;
  return segments.flatMap((segment) =>
    perforatePolyline({ points: segment.polyline, closed: segment.closed }, pattern).map(
      (dash) => ({
        polyline: dash.points,
        closed: false,
        ...(segment.nesting === undefined ? {} : { nesting: segment.nesting }),
      }),
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

/** The group field for the operation's leads; empty when it asks for none or
 * nothing it cuts is closed. A perforated cut never is. */
export function lineLeadFields(
  settings: LayerOperationSettings & { readonly id: string; readonly name: string },
  segments: ReadonlyArray<CutSegment>,
): Pick<CutGroup, 'laserLeads'> {
  const spec = laserLeadSpecFor(settings);
  if (spec === null || !segments.some((segment) => segment.closed)) return {};
  return { laserLeads: { ...spec, operationName: settings.name } };
}

/** What Job Review says when an operation asks for leads its cuts cannot take. */
export function lineLeadDiagnostics(
  settings: LayerOperationSettings & { readonly id: string; readonly name: string },
  tabbedContours: number,
): ReadonlyArray<JobDiagnostic> {
  if (laserLeadSpecFor(settings) === null) return [];
  if (perforationPatternFor(settings) !== null)
    return [{ kind: 'laser-leads-perforated', layerId: settings.id, layerName: settings.name }];
  return tabbedContours > 0
    ? [
        {
          kind: 'laser-leads-tabbed',
          layerId: settings.id,
          layerName: settings.name,
          count: tabbedContours,
        },
      ]
    : [];
}
