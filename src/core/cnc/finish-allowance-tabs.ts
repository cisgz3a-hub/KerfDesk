// Holding tabs for a profile cut with a finish allowance (ADR-140 Amendment 2).
//
// The bridges are planned on the true-wall finishing rings, exactly where the
// same layer puts them without an allowance (persisted anchors, otherwise even
// spacing). Every roughing ring then rises wherever its slot runs beside one of
// those bridges. Planning from roughing instead broke when parts sit between one
// and one-plus-two-allowances cut widths apart: their roughing offsets merge into
// one ring that belongs to a single part, so the other parts' finishing tabs
// stood against nothing and each pass cut through the other's bridges.
//
// Pure: no clock, no randomness, no I/O.

import type { Polyline, Vec2 } from '../scene';
import { tabCenterPoints, tabFractionsNear, type TabRampSettings } from './cnc-tab-ramp';

/**
 * Tab centres, as perimeter fractions, for each roughing ring that runs beside a
 * finishing bridge. `cutWidthMm` is how far a roughing ring may lie from a bridge
 * and still cut into it: each slot reaches half a cut width from its own ring. A
 * roughing ring with no bridge in reach keeps `roughManualCenters` or its own
 * even spacing, as before; its tabs then hold only waste, never a part.
 */
export function roughingTabCentersBesideFinishTabs(
  finishToolpaths: ReadonlyArray<Polyline>,
  roughToolpaths: ReadonlyArray<Polyline>,
  tabs: TabRampSettings,
  finishManualCenters: ReadonlyMap<Polyline, ReadonlyArray<number>>,
  roughManualCenters: ReadonlyMap<Polyline, ReadonlyArray<number>>,
  cutWidthMm: number,
): ReadonlyMap<Polyline, ReadonlyArray<number>> {
  const anchors: Vec2[] = finishToolpaths.flatMap((toolpath) =>
    tabCenterPoints(toolpath, tabs, finishManualCenters.get(toolpath)),
  );
  const centers = new Map(roughManualCenters);
  for (const toolpath of roughToolpaths) {
    // A bounds test first keeps a large nest from projecting every bridge onto
    // every ring.
    const nearby = anchors.filter(withinBounds(toolpath, cutWidthMm));
    const fractions = tabFractionsNear(toolpath, nearby, cutWidthMm);
    if (fractions.length > 0) centers.set(toolpath, fractions);
  }
  return centers;
}

function withinBounds(toolpath: Polyline, marginMm: number): (point: Vec2) => boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of toolpath.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return (point) =>
    point.x >= minX - marginMm &&
    point.x <= maxX + marginMm &&
    point.y >= minY - marginMm &&
    point.y <= maxY + marginMm;
}
