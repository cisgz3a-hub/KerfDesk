// The depth half of a CNC operation's Job Review detail: its pass count, read
// from the ladder the compiler steps with, and whether its closed shapes keep
// holding tabs (cnc-tabs.ts).

import { isProfileCutType, passNeedsTabs, zPassDepths } from '../../../core/cnc';
// Deep import: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import { depthsWithTabTopPass, settingsWithStockTabGate } from '../../../core/cnc/cnc-tabs';
import { DEFAULT_CNC_STOCK, type CncLayerSettings } from '../../../core/scene';
import { formatMm } from './job-review-format';

export function cncDepthParts(
  settings: CncLayerSettings,
  besideReliefs: boolean,
  stockThicknessMm: number | undefined,
  compiledTabs: boolean | undefined,
): ReadonlyArray<string> {
  if (settings.cutType === 'v-carve') {
    return (settings.vCarveFlatDepthEnabled ?? true)
      ? [
          `requested flat floor ${formatMm(settings.depthMm)} mm`,
          `max stepdown ${formatMm(settings.depthPerPassMm)} mm`,
        ]
      : ['flowing V-depth', `max stepdown ${formatMm(settings.depthPerPassMm)} mm`];
  }
  const passes = cncDepthLevelCount(settings, stockThicknessMm, compiledTabs);
  // Cut depth reaches only the shapes that are not reliefs.
  const where = besideReliefs ? ' on the other shapes' : '';
  return [`${passes} ${passes === 1 ? 'pass' : 'passes'}${where}`];
}

// The compiler's own rule (cnc-tabs.ts): whether a closed shape of this
// operation gets tabs on its deepest pass.
export function closedShapesGetTabs(
  settings: CncLayerSettings,
  stockThicknessMm?: number,
): boolean {
  if (!settings.tabsEnabled) return false;
  const tabs = settingsWithStockTabGate(
    settings,
    stockThicknessMm ?? DEFAULT_CNC_STOCK.thicknessMm,
  );
  return tabs.tabsEnabled && passNeedsTabs(-tabs.depthMm, tabs.depthMm, tabs.tabHeightMm);
}

// A closed profile that keeps tabs is cut at one more level, the tab top
// (depthsWithTabTopPass), so the count follows the compiler's ladder (CNC
// audit v1 F4-P3-1). Compiled passes that rise into no tab cut open paths,
// which keep the plain ladder.
function cncDepthLevelCount(
  settings: CncLayerSettings,
  stockThicknessMm: number | undefined,
  compiledTabs: boolean | undefined,
): number {
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  if (
    !isProfileCutType(settings.cutType) ||
    compiledTabs === false ||
    !closedShapesGetTabs(settings, stockThicknessMm)
  ) {
    return depths.length;
  }
  const tabs = settingsWithStockTabGate(
    settings,
    stockThicknessMm ?? DEFAULT_CNC_STOCK.thicknessMm,
  );
  return depthsWithTabTopPass(depths, tabs).length;
}
