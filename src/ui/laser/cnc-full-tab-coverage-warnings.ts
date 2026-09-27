// detectCncFullTabCoverageWarnings — CNC-mode advisory: holding tabs are
// enabled, but the requested windows (tab width + the bit's cut width at full
// depth, times tabs per shape) cover the whole perimeter of the layer's
// shapes, so no material below the tab top is ever removed and the part is
// NEVER cut through — the loop stays one full bridge (AUDIT A5). Detected from
// the compiled job: the layer cuts at/above its tab top but nowhere below it.
// The cut width is the bit diameter for a flat end mill, and for a bit that
// narrows toward its tip the width it cuts at the full depth (ADR-368
// Amendments 2 and 3).
//
// ADR-258 changed the mechanism, not the condition. The split model achieved
// this by SKIPPING the below-tab-top passes; tabs are now a Z-rise, so the loop
// RIDES at the tab top instead. Either way nothing is cut deeper, so the
// advisory is still correct and still needed — which is why it reads Z from
// path3d passes as well as contour ones.
//
// This is an advisory, not a gate (ADR-206: warn, don't block) — the compiler
// already keeps the cut safe; this explains WHY the part will not come free.
// Limitation: a layer where only SOME shapes are fully covered still has deep
// passes from the others and is not flagged here — those shapes still keep
// their bridges, the advisory just stays quiet.

import { compileCncJob, isProfileCutType, passNeedsTabs, tabTopZMm } from '../../core/cnc';
import { settingsWithStockTabGate } from '../../core/cnc/cnc-tabs';
import { cncLayoutCutWidths } from '../../core/cnc/layout-cut-widths';
import type { Job } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Project,
} from '../../core/scene';
import { formatMm } from './job-review/job-review-format';

const Z_EPS = 1e-9;

export function detectCncFullTabCoverageWarnings(
  project: Project,
  compiledJob?: Job,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];

  // The compiler's own tab settings: skipped where the floor holds the part, and
  // measured from the stock bottom when the stock is set (ADR-258 amendment 3).
  const stockThicknessMm = machine.stock.thicknessMm;
  const tabSettings = (layer: Layer) =>
    settingsWithStockTabGate(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS, stockThicknessMm);
  const candidates = project.scene.layers.filter(
    (layer) => layer.output && layerRequestsDeepTabbedProfile(tabSettings(layer)),
  );
  if (candidates.length === 0) return [];

  const job = compiledJob ?? compileCncJob(project.scene, project.device, machine);
  const warnings: string[] = [];
  for (const layer of candidates) {
    const settings = tabSettings(layer);
    const tabTop = tabTopZMm(settings.depthMm, settings.tabHeightMm);
    const passZs = job.groups
      .flatMap((group) =>
        group.kind === 'cnc' && group.layerId === layer.id && isProfileCutType(group.cutType)
          ? group.passes
          : [],
      )
      // Read Z from BOTH pass kinds. Since ADR-258 a tabbed deep pass is a path3d
      // carrying per-vertex Z, and ADR-250 leads turn full-loop contour passes into
      // path3d too — so a contour-only filter sees nothing at all on a tabbed layer
      // and this advisory silently stops firing.
      .flatMap((pass) => {
        if (pass.kind === 'contour') return [pass.zMm];
        if (pass.kind === 'path3d') return pass.points.map((point) => point.z);
        return [];
      });
    const cutsAtOrAboveTabTop = passZs.some((zMm) => zMm >= tabTop - Z_EPS);
    const cutsBelowTabTop = passZs.some((zMm) => zMm < tabTop - Z_EPS);
    if (cutsAtOrAboveTabTop && !cutsBelowTabTop) {
      warnings.push(
        `Layer ${layer.id}: the requested holding tabs (tab width + ` +
          `${tabCutWidthLabel(machine, settings)} × ${settings.tabsPerShape} tabs) cover the ` +
          'whole perimeter, so every pass below the tab top is skipped and the part will NOT ' +
          'be cut through. Use fewer or narrower tabs, a smaller bit, or a larger shape.',
      );
    }
  }
  return warnings;
}

// What each tab window adds to the tab width: the width the bit cuts at the
// full depth, which is its diameter unless it narrows toward its tip.
function tabCutWidthLabel(machine: CncMachineConfig, settings: CncLayerSettings): string {
  const tool = layerCncTool(machine, settings);
  const { wallDiameterMm } = cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm);
  return wallDiameterMm < tool.diameterMm
    ? `the bit's ${formatMm(wallDiameterMm)} mm cut width`
    : 'bit diameter';
}

function layerRequestsDeepTabbedProfile(settings: CncLayerSettings): boolean {
  return (
    settings.tabsEnabled &&
    isProfileCutType(settings.cutType) &&
    passNeedsTabs(-settings.depthMm, settings.depthMm, settings.tabHeightMm)
  );
}
