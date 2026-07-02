// CNC holding tabs — leave small bridges of material so a through-cut part
// does not break free and get thrown by the spindle on the final passes.
//
// Model: tabs occupy the bottom `tabHeightMm` of the cut. Passes at or above
// the tab top cut the full loop; passes below it skip the tab intervals —
// reusing the laser tab-splitting geometry (skip windows along the perimeter).
// The skip length adds one tool diameter so the PHYSICAL bridge is the
// requested width after the bit (radius on each side) eats into the gap.

import { applyAutomaticTabsToPolylines } from '../geometry/tabs-bridges';
import type { Polyline } from '../scene';

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
): ReadonlyArray<Polyline> {
  if (!polyline.closed) return [polyline];
  return applyAutomaticTabsToPolylines([polyline], {
    tabsEnabled: true,
    tabSizeMm: Math.max(0, settings.tabWidthMm) + Math.max(0, settings.toolDiameterMm),
    tabsPerShape: settings.tabsPerShape,
    // CNC tabs go on every through-cut contour — a freed hole slug is as
    // dangerous as a freed part.
    tabSkipInnerShapes: false,
  });
}
