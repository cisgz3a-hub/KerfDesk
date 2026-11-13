// Holding tabs on an open outline that the cut frees all the same (ADR-258
// Amendments 5 and 7).
//
// Amendment 5 tabbed an open outline as a closed loop when its ends lie closer
// than the cut width: the bit sweeps the gap. CNC audit v3 N7-P1-2 found the
// outline whose ends are just over one cut width apart: nothing sweeps the gap,
// but all that is left across it is a sliver of gap - D, 0.025 mm on the 1/8"
// bit at a 3.2 mm gap, through the whole cut depth. It got no tabs and no
// warning, and tears free on the last pass.
//
// Amendment 7: the gap is closed for tabs while the sliver's section, (gap - D)
// times the cut depth, is smaller than one tab's, tab width times tab height,
// and at least while it is under THIN_POCKET_FLOOR_MM (0.2 mm), the codebase's
// "holds nothing" floor. With the default 6 x 2 mm tabs through 6.35 mm that is
// any gap under D + 1.89 mm. The tabs keep off the gap itself, where the cut
// does not run and a tab would hold nothing.
//
// Pure: no clock, no randomness, no I/O.

import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { CncLayerSettings, Polyline } from '../scene';
import { circularGap, modulo, tabLoop } from './cnc-tab-loop';
import { windowsBridgeMm, type TabPlan } from './cnc-tab-placement';

const EPS = 1e-9;
/** A wall thinner than this holds nothing (THIN_POCKET_FLOOR_MM). */
const SLIVER_HOLDS_NOTHING_MM = 0.2;

/** The gap between an open outline's ends, or null when it is not a loop the cut could free. */
export function openOutlineGapMm(toolpath: Polyline, cutWidthMm: number): number | null {
  const first = toolpath.points[0];
  const last = toolpath.points[toolpath.points.length - 1];
  if (toolpath.closed || toolpath.points.length < 3 || first === undefined || last === undefined) {
    return null;
  }
  // Around no more than the bit's own footprint there is nothing to hold.
  if (!(Math.abs(signedAreaMm2(toolpath.points)) > cutWidthMm * cutWidthMm)) return null;
  return Math.hypot(last.x - first.x, last.y - first.y);
}

/**
 * The widest gap still tabbed as a closed loop: the cut width, plus the sliver
 * that holds less than one tab (at least 0.2 mm).
 */
export function closedForTabsBelowMm(settings: CncLayerSettings, cutWidthMm: number): number {
  const tabSectionMm2 = Math.max(0, settings.tabWidthMm) * Math.max(0, settings.tabHeightMm);
  const depthMm = Math.max(0, settings.depthMm);
  const sliverMm = depthMm > EPS ? tabSectionMm2 / depthMm : 0;
  return cutWidthMm + Math.max(SLIVER_HOLDS_NOTHING_MM, sliverMm);
}

/** True when the cut frees what this open outline goes round (see above). */
export function cutFreesOpenOutline(
  toolpath: Polyline,
  settings: CncLayerSettings,
  cutWidthMm: number,
): boolean {
  const gapMm = openOutlineGapMm(toolpath, cutWidthMm);
  return gapMm !== null && gapMm < closedForTabsBelowMm(settings, cutWidthMm) - EPS;
}

/**
 * `plan` for `loop` (the open outline closed across its gap) with every window
 * moved off the gap: the windows shift together until the gap's middle sits
 * halfway between two of them. Unchanged when no window touches the gap.
 */
export function planClearOfGap(loop: Polyline, plan: TabPlan, cutWidthMm: number): TabPlan {
  const measured = tabLoop(loop.points);
  if (measured === null || plan.coversLoop || plan.centers.length === 0) return plan;
  const { perimeter } = measured;
  const openLengthMm = measured.cumulative[measured.points.length - 1] as number;
  const gapLengthMm = perimeter - openLengthMm;
  const gapMiddle = openLengthMm + gapLengthMm / 2;
  const touches = plan.centers.some(
    (center) => circularGap(center, gapMiddle, perimeter) < (plan.windowMm + gapLengthMm) / 2 - EPS,
  );
  if (!touches) return plan;
  const sorted = [...plan.centers].sort((a, b) => a - b);
  let delta = 0;
  sorted.forEach((center, index) => {
    const next =
      index + 1 < sorted.length ? (sorted[index + 1] as number) : (sorted[0] as number) + perimeter;
    const between = modulo(gapMiddle - center, perimeter);
    if (between < next - center) delta = between - (next - center) / 2;
  });
  const centers = plan.centers.map((center) => modulo(center + delta, perimeter));
  return {
    ...plan,
    centers,
    narrowestBridgeMm: windowsBridgeMm(measured, centers, plan.windowMm, cutWidthMm),
  };
}
