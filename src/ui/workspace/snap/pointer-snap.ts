// pointer-snap — where a drawing, measuring or node-editing pointer lands
// (LightBurn gap LBG-F06).
//
// Two mechanisms, ranked as in the Design Studio (ADR-272): a point on real
// artwork always beats the grid, because dragging a real node off to the nearest
// grid line is the most damaging thing a snapping system can do in a precision
// tool. The grid is magnetic, per axis, within the same reach — the rule box
// alignment has always used when moving — so a coordinate near a grid line
// lands on it and one between lines is left alone. A snapped grid axis shows a
// guide across the bed; both axes together show the grid marker.

import type { Project, Vec2 } from '../../../core/scene';
import type { SnapSettings } from '../snap-settings';
import type { SnapGuide } from '../snapping';
import type { SnapExclusion } from './snap-exclusion';
import { findPointSnap } from './scene-snap-query';
import { enabledPointSnapKinds, type SnapMarker } from './snap-kinds';

export type PointerSnapResult = {
  readonly pointMm: Vec2;
  readonly marker: SnapMarker | null;
  readonly guides: ReadonlyArray<SnapGuide>;
};

export function snapReachMm(settings: SnapSettings, pxToMm: number): number {
  const reach = settings.distancePx * pxToMm;
  return Number.isFinite(reach) && reach > 0 ? reach : 0;
}

export function resolvePointerSnap(args: {
  readonly project: Project;
  readonly rawMm: Vec2;
  readonly pxToMm: number;
  readonly settings: SnapSettings;
  // The operator is holding the no-snap modifier, or a constraint owns the point.
  readonly suppressed: boolean;
  readonly exclusion?: SnapExclusion;
}): PointerSnapResult {
  const unsnapped = { pointMm: args.rawMm, marker: null, guides: [] };
  if (!args.settings.enabled || args.suppressed) return unsnapped;
  const radiusMm = snapReachMm(args.settings, args.pxToMm);
  if (radiusMm <= 0) return unsnapped;
  const target = findPointSnap({
    project: args.project,
    pointMm: args.rawMm,
    radiusMm,
    kinds: enabledPointSnapKinds(args.settings),
    ...(args.exclusion === undefined ? {} : { exclusion: args.exclusion }),
  });
  if (target !== null) {
    return {
      pointMm: target.pointMm,
      marker: { kind: target.kind, pointMm: target.pointMm },
      guides: [],
    };
  }
  if (!args.settings.snapToGrid) return unsnapped;
  return snapToGridLines(args.project, args.rawMm, args.settings.gridMm, radiusMm);
}

export function snapToGridLines(
  project: Project,
  rawMm: Vec2,
  gridMm: number,
  radiusMm: number,
): PointerSnapResult {
  const x = magneticGridValue(rawMm.x, gridMm, radiusMm);
  const y = magneticGridValue(rawMm.y, gridMm, radiusMm);
  const pointMm = { x: x ?? rawMm.x, y: y ?? rawMm.y };
  const guides: SnapGuide[] = [];
  const { bedWidth, bedHeight } = project.device;
  if (x !== null) guides.push({ axis: 'x', positionMm: x, fromMm: 0, toMm: bedHeight });
  if (y !== null) guides.push({ axis: 'y', positionMm: y, fromMm: 0, toMm: bedWidth });
  const marker: SnapMarker | null = x !== null && y !== null ? { kind: 'grid', pointMm } : null;
  return { pointMm, marker, guides };
}

function magneticGridValue(value: number, gridMm: number, radiusMm: number): number | null {
  if (!(gridMm > 0) || !Number.isFinite(gridMm)) return null;
  const line = Math.round(value / gridMm) * gridMm;
  return Math.abs(line - value) <= radiusMm ? line : null;
}
