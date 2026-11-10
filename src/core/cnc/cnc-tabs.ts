// CNC holding tabs — leave small bridges of material so a through-cut part
// does not break free and get thrown by the spindle on the final passes.
//
// Model: tabs occupy the bottom `tabHeightMm` of the cut. Passes at or above
// the tab top cut the full loop; passes below it skip the tab intervals —
// (with a set stock thickness the compiler measures that height from the stock
// bottom instead, through settingsWithStockTabGate; ADR-258 amendment 3, and
// cuts a tab no thinner than the stock half the stock thick; amendment 4) —
// reusing the laser tab-splitting geometry (skip windows along the perimeter).
// The skip length adds one tool diameter so the PHYSICAL bridge is the
// requested width after the bit (radius on each side) eats into the gap.
//
// Degenerate coverage: when the requested windows swallow a contour's whole
// perimeter, the split returns NO pieces — the deep pass is skipped and the
// loop stays one full bridge. Cutting the unsplit loop instead (the pre-fix
// fallback) freed the part with the spindle running (AUDIT A5).

import { applyAutomaticTabsToPolylines, applyManualTabsToPolyline } from '../geometry/tabs-bridges';
import { DEFAULT_CNC_STOCK, type CncLayerSettings, type Polyline } from '../scene';

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
  // A tab only means anything when the cut goes DEEPER than the tab: otherwise the
  // "tab" spans the whole cut and leaves the full depth uncut at each window. With
  // the shipped defaults (1 mm depth, 2 mm tab height) that would put four uncut
  // gaps in every shallow profile — visible, pointless, and unable to hold a part
  // that was never being released. Bailing here also makes tabTopZMm's clamped
  // "tabs everywhere" case unreachable from compilation (ADR-258).
  if (!(depthMm > tabHeightMm + TAB_EPS)) return false;
  return zMm < tabTopZMm(depthMm, tabHeightMm) - TAB_EPS;
}

// ADR-258 amendment 4 (second CNC audit P2-toolpath-2): the tab a set stock
// thickness leaves standing on the stock bottom. A tab at least as thick as the
// stock would reach the stock top, so no pass could cut over it and
// passNeedsTabs dropped it, freeing a part cut through thin sheet under the
// default 2 mm tab. Such a tab is cut half the stock thick instead: still a
// real bridge, and still the same whatever the cut depth (amendment 3). The
// shipped stock thickness reads as never set, so the request stands there.
export function stockLimitedTabHeightMm(tabHeightMm: number, stockThicknessMm: number): number {
  if (stockThicknessMm === DEFAULT_CNC_STOCK.thicknessMm) return tabHeightMm;
  return tabHeightMm < stockThicknessMm - TAB_EPS ? tabHeightMm : stockThicknessMm / 2;
}

// ADR-258 amendment 1: tabs belong on cuts that can free the part. A floor at
// least one tab height thick under the cut holds the part better than tabs, and
// tabs there only leave bumps along the groove; Easel likewise adds tabs only
// when the cut depth reaches the material thickness. A floor thinner than a tab
// keeps them, so a stock thickness set slightly off still gets tabs. The tab
// compared is the one the compiler cuts (amendment 4). The shipped stock
// thickness is indistinguishable from never having set it, so on that value
// any cut may go through and the depth-only rule above stays in force.
export function cutCanFreePart(
  depthMm: number,
  tabHeightMm: number,
  stockThicknessMm: number,
): boolean {
  if (stockThicknessMm === DEFAULT_CNC_STOCK.thicknessMm) return true;
  const keptTabMm = stockLimitedTabHeightMm(tabHeightMm, stockThicknessMm);
  return stockThicknessMm - depthMm < keptTabMm - TAB_EPS;
}

// ADR-258 amendment 3 (CNC audit TP-1): with a set stock thickness a tab is one
// tab height of material above the stock bottom, as Easel measures it, so a cut
// that runs on into the spoilboard no longer thins or removes the tabs. The pass
// builders measure the tab top up from the cut floor (tabTopZMm), so this is the
// floor-measured height that puts the top there. The shipped stock thickness
// reads as never set and keeps the cut-floor rule, as cutCanFreePart does.
export function tabHeightAboveCutFloorMm(
  depthMm: number,
  tabHeightMm: number,
  stockThicknessMm: number,
): number {
  if (stockThicknessMm === DEFAULT_CNC_STOCK.thicknessMm) return tabHeightMm;
  const keptTabMm = stockLimitedTabHeightMm(tabHeightMm, stockThicknessMm);
  return keptTabMm + Math.max(0, depthMm) - stockThicknessMm;
}

/** The layer settings the pass builders see: tabs off where the floor holds the
 * part, and a kept tab measured from the stock bottom when the stock is set. */
export function settingsWithStockTabGate(
  settings: CncLayerSettings,
  stockThicknessMm: number,
): CncLayerSettings {
  if (!settings.tabsEnabled) return settings;
  if (!cutCanFreePart(settings.depthMm, settings.tabHeightMm, stockThicknessMm)) {
    return { ...settings, tabsEnabled: false };
  }
  const tabHeightMm = tabHeightAboveCutFloorMm(
    settings.depthMm,
    settings.tabHeightMm,
    stockThicknessMm,
  );
  return tabHeightMm === settings.tabHeightMm ? settings : { ...settings, tabHeightMm };
}

/** A closed tabbed contour's depth ladder: the plain ladder plus one level at
 * the tab top, where the loop is cut whole before the passes below skip the
 * tabs. Job Review counts passes from the same ladder (CNC audit v1 F4-P3-1). */
export function depthsWithTabTopPass(
  depths: ReadonlyArray<number>,
  settings: CncLayerSettings,
): ReadonlyArray<number> {
  const tabTop = tabTopZMm(settings.depthMm, settings.tabHeightMm);
  if (tabTop >= -TAB_EPS || tabTop <= -settings.depthMm + TAB_EPS) return depths;
  if (depths.some((z) => Math.abs(z - tabTop) <= TAB_EPS)) return depths;
  return [...depths, tabTop].sort((a, b) => b - a);
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
