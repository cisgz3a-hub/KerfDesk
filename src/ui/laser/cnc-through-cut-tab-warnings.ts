// detectCncThroughCutTabWarnings — CNC-mode advisory: a profile layer whose
// cut depth reaches (or passes) the stock thickness with holding tabs disabled
// frees the part — and any interior hole slugs — on the final pass, where they
// can catch the bit or fly off. The out-of-box layer does NOT trip this: the
// default cut depth is 1 mm against 6.35 mm stock (machine.ts), so the advisory
// only fires once the operator deepens the cut.
//
// It also reports the plainer case the free-part rule misses: fixed-depth cuts
// set deeper than the stock are cutting into the spoilboard. V-carve is handled
// from exact compiled pass depth because flowing mode ignores settings.depthMm.
//
// This is an advisory, not a hard gate — through-cutting onto a spoilboard is a
// legitimate workflow. KerfDesk warns rather than silently auto-adding tabs
// (divergence from Easel's auto-tab default, recorded in the CNC-defaults ADR).

import { isProfileCutType } from '../../core/cnc';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
} from '../../core/scene';

export function detectCncThroughCutTabWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  const stockThicknessMm = machine.stock.thicknessMm;

  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    // Relief depth belongs to each relief object. A stale layer depth is not
    // physical evidence when every object on the operation is a relief; the
    // prepared-job warning below uses the exact rough/finish pass depth.
    if (layerCarriesOnlyReliefs(project, layer)) continue;
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
    } else if (settings.depthMm > stockThicknessMm && settings.cutType !== 'v-carve') {
      // Spoilboard overcut. Legitimate on purpose, so this informs and never
      // refuses; the free-part case above is the louder one and wins the row.
      const pastMm = settings.depthMm - stockThicknessMm;
      warnings.push(
        `Layer ${layer.id} cuts ${settings.depthMm} mm into ${stockThicknessMm} mm stock — ` +
          `${pastMm.toFixed(2)} mm past the bottom, into the spoilboard. ` +
          'Reduce the cut depth if that is not intended.',
      );
    }
  }
  return warnings;
}

function layerCarriesOnlyReliefs(project: Project, layer: Layer): boolean {
  const bound = project.scene.objects.filter((object) => sceneObjectUsesOperation(object, layer));
  return (
    bound.some((object) => object.kind === 'relief') &&
    !bound.some((object) => object.kind !== 'relief' && object.kind !== 'raster-image')
  );
}
