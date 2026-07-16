// CNC holding tabs — leave small bridges of material so a through-cut part
// does not break free and get thrown by the spindle on the final passes.
//
// Model: tabs occupy the bottom `tabHeightMm` of the cut. Passes at or above
// the tab top cut the full loop; passes below it skip the tab intervals —
// reusing the laser tab-splitting geometry (skip windows along the perimeter).
// The skip length adds one tool diameter so the PHYSICAL bridge is the
// requested width after the bit (radius on each side) eats into the gap.
//
// Degenerate coverage: when the requested windows swallow a contour's whole
// perimeter, the split returns NO pieces — the deep pass is skipped and the
// loop stays one full bridge. Cutting the unsplit loop instead (the pre-fix
// fallback) freed the part with the spindle running (AUDIT A5).

import {
  applyAutomaticTabsToPolylines,
  applyManualTabsToPolyline,
  automaticTabAnchorPoints,
  splitClosedPolylineForTabsAtAnchors,
} from '../geometry/tabs-bridges';
import type { Polyline, Vec2 } from '../scene';

export type CncTabSettings = {
  readonly tabWidthMm: number;
  readonly tabsPerShape: number;
  readonly toolDiameterMm: number;
};

const TAB_EPS = 1e-9;

// Z of the tab top: passes strictly below this Z must skip tab intervals.
// Clamped so tabHeight ≥ depth degenerates to "tabs everywhere" (top = 0).
export function tabTopZMm(depthMm: number, tabHeightMm: number): number {
  const height = Math.min(Math.max(0, tabHeightMm), Math.max(0, depthMm));
  return -(Math.max(0, depthMm) - height);
}

export function passNeedsTabs(zMm: number, depthMm: number, tabHeightMm: number): boolean {
  return zMm < tabTopZMm(depthMm, tabHeightMm) - TAB_EPS;
}

export function splitPassForTabs(
  polyline: Polyline,
  settings: CncTabSettings,
  manualCenters?: ReadonlyArray<number>,
): ReadonlyArray<Polyline> {
  if (!polyline.closed) return [polyline];
  const tabSizeMm = Math.max(0, settings.tabWidthMm) + Math.max(0, settings.toolDiameterMm);
  if (manualCenters !== undefined) {
    return applyManualTabsToPolyline(polyline, manualCenters, tabSizeMm);
  }
  return applyAutomaticTabsToPolylines([polyline], {
    tabsEnabled: true,
    tabSizeMm,
    tabsPerShape: settings.tabsPerShape,
    // CNC tabs go on every through-cut contour — a freed hole slug is as
    // dangerous as a freed part.
    tabSkipInnerShapes: false,
  });
}

export function splitPassForTabsAlignedToReference(
  polyline: Polyline,
  references: ReadonlyArray<Polyline>,
  settings: CncTabSettings,
): ReadonlyArray<Polyline> {
  const reference = closestClosedReference(polyline, references);
  if (reference === null) return splitPassForTabs(polyline, settings);
  const anchors = automaticTabAnchorPoints(reference, settings.tabsPerShape);
  return splitClosedPolylineForTabsAtAnchors(
    polyline,
    anchors,
    Math.max(0, settings.tabWidthMm) + Math.max(0, settings.toolDiameterMm),
  );
}

function closestClosedReference(
  target: Polyline,
  references: ReadonlyArray<Polyline>,
): Polyline | null {
  let best: Polyline | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const reference of references) {
    if (!reference.closed || reference.points.length < 3) continue;
    const distance = averageDistanceToPolyline(target.points, reference.points);
    if (distance < bestDistance - TAB_EPS) {
      best = reference;
      bestDistance = distance;
    }
  }
  return best;
}

function averageDistanceToPolyline(
  points: ReadonlyArray<Vec2>,
  polyline: ReadonlyArray<Vec2>,
): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const point of points) {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < polyline.length; index += 1) {
      const start = polyline[index];
      const end = polyline[(index + 1) % polyline.length];
      if (start !== undefined && end !== undefined) {
        nearest = Math.min(nearest, pointToSegmentDistance(point, start, end));
      }
    }
    total += nearest;
  }
  return total / points.length;
}

function pointToSegmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= TAB_EPS
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}
