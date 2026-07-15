// detectCncThroughCutTabWarnings — CNC-mode advisory: a profile layer whose
// cut depth reaches (or passes) the stock thickness with holding tabs disabled
// frees the part — and any interior hole slugs — on the final pass, where they
// can catch the bit or fly off. The out-of-box default layer is exactly this
// (profile-outside, depth == stock == 6.35 mm, tabs off).
//
// This is an advisory, not a hard gate — through-cutting onto a spoilboard is a
// legitimate workflow. KerfDesk warns rather than silently auto-adding tabs
// (divergence from Easel's auto-tab default, recorded in the CNC-defaults ADR).

import { isProfileCutType } from '../../core/cnc';
import { DEFAULT_CNC_LAYER_SETTINGS, type Project } from '../../core/scene';

export function detectCncThroughCutTabWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  const stockThicknessMm = machine.stock.thicknessMm;

  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const cutsThrough =
      isProfileCutType(settings.cutType) &&
      settings.depthMm >= stockThicknessMm &&
      !settings.tabsEnabled;
    if (cutsThrough) {
      warnings.push(
        `Layer ${layer.id} cuts through the stock (${settings.depthMm} mm ≥ ${stockThicknessMm} mm) ` +
          'with no holding tabs — the part and any hole slugs come free on the final pass. ' +
          'Enable Tabs or reduce the cut depth.',
      );
    }
  }
  return warnings;
}
