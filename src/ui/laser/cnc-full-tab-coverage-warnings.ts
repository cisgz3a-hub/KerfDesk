// detectCncFullTabCoverageWarnings — CNC-mode advisory: holding tabs are
// enabled, but the requested windows (tab width + bit diameter, times tabs
// per shape) cover the whole perimeter of the layer's shapes, so the compiler
// skips every pass below the tab top and the part is NEVER cut through — the
// loop stays one full bridge (AUDIT A5). Detected from the compiled job: the
// layer produced profile passes at/above its tab top but none below it.
//
// This is an advisory, not a gate (ADR-206: warn, don't block) — the
// compiler's skip already keeps the cut safe; this explains WHY the part
// will not come free. Limitation: a layer where only SOME shapes are fully
// covered still has deep passes from the others and is not flagged here —
// those shapes still keep their bridges, the advisory just stays quiet.

import { compileCncJob, isProfileCutType, passNeedsTabs, tabTopZMm } from '../../core/cnc';
import { DEFAULT_CNC_LAYER_SETTINGS, type Layer, type Project } from '../../core/scene';

const Z_EPS = 1e-9;

export function detectCncFullTabCoverageWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];

  const candidates = project.scene.layers.filter(layerRequestsDeepTabbedProfile);
  if (candidates.length === 0) return [];

  const job = compileCncJob(project.scene, project.device, machine);
  const warnings: string[] = [];
  for (const layer of candidates) {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const tabTop = tabTopZMm(settings.depthMm, settings.tabHeightMm);
    const passZs = job.groups
      .flatMap((group) =>
        group.kind === 'cnc' && group.layerId === layer.id && isProfileCutType(group.cutType)
          ? group.passes
          : [],
      )
      .flatMap((pass) => (pass.kind === 'contour' ? [pass.zMm] : []));
    const cutsAtOrAboveTabTop = passZs.some((zMm) => zMm >= tabTop - Z_EPS);
    const cutsBelowTabTop = passZs.some((zMm) => zMm < tabTop - Z_EPS);
    if (cutsAtOrAboveTabTop && !cutsBelowTabTop) {
      warnings.push(
        `Layer ${layer.id}: the requested holding tabs (tab width + bit diameter × ` +
          `${settings.tabsPerShape} tabs) cover the whole perimeter, so every pass below the tab ` +
          'top is skipped and the part will NOT be cut through. Use fewer or narrower tabs, a ' +
          'smaller bit, or a larger shape.',
      );
    }
  }
  return warnings;
}

function layerRequestsDeepTabbedProfile(layer: Layer): boolean {
  if (!layer.output) return false;
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  return (
    settings.tabsEnabled &&
    isProfileCutType(settings.cutType) &&
    passNeedsTabs(-settings.depthMm, settings.depthMm, settings.tabHeightMm)
  );
}
