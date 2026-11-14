// Holding tabs on an open outline that the cut frees all the same (ADR-258
// Amendments 5, 7 and 8).
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
// any gap under D + 1.89 mm.
//
// Amendment 8 (CNC audit v3 N8-P2-1): the tabs stay where the closed loop's
// corner-avoiding plan puts them (Amendment 5), even over the gap. Amendment 7
// moved them all off it together, which put every tab of a square or L opened
// at mid-edge on a corner (6.00 -> 3.27 mm bridges; 1 mm tabs cut free). A
// window over the gap holds its full width: the cut rides the tab top from the
// window's edge to the outline's end, so each kerf still stops at a window edge
// and the material between them is the window less the cut width, sliver or no.
//
// Pure: no clock, no randomness, no I/O.

import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { CncLayerSettings, Polyline } from '../scene';

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
