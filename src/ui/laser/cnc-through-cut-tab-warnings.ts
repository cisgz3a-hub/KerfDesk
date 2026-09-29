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
//
// ADR-258 amendment 2: the compiler drops enabled tabs where the project's stock
// thickness leaves a floor under the cut (cutCanFreePart). That thickness is
// only what the project says, and a value left from thicker stock frees the
// parts with no tabs, so a skip always names the thickness it relied on.
//
// ADR-258 amendment 4: what these warnings say about tabs comes from the
// compiled passes (compiled-tab-rises.ts), so an overcut note names tabs only
// where a pass rises into one (an open path gets none), says when a tab no
// thinner than the stock was cut half the stock thick, and a through cut with
// Tabs on still warns when no tab can be cut at its depth.

import { compileCncJob, isProfileCutType, passNeedsTabs, tabTopZMm } from '../../core/cnc';
import {
  cutCanFreePart,
  settingsWithStockTabGate,
  stockLimitedTabHeightMm,
} from '../../core/cnc/cnc-tabs';
import { tabbedProfileLayerIds } from '../../core/cnc/compiled-tab-rises';
import type { Job } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_STOCK,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type Layer,
  type Project,
} from '../../core/scene';
import { cncNoteContours } from '../layers/cnc-note-contours';
import { formatMm } from './job-review/job-review-format';

export function detectCncThroughCutTabWarnings(
  project: Project,
  compiledJob?: Job,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  const stockThicknessMm = machine.stock.thicknessMm;
  // The operations whose passes really rise into tabs. Compiled here only when
  // a tabbed overcut asks and the caller has no job, as the full tab coverage
  // advisory does.
  let tabbed: ReadonlySet<string> | undefined;
  const cutsTabs = (layer: Layer): boolean => {
    tabbed ??= tabbedProfileLayerIds(
      compiledJob ?? compileCncJob(project.scene, project.device, machine),
    );
    return tabbed.has(layer.id);
  };

  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    // Relief depth belongs to each relief object. A stale layer depth is not
    // physical evidence when every object on the operation is a relief; the
    // prepared-job warning below uses the exact rough/finish pass depth.
    if (layerCarriesOnlyReliefs(project, layer)) continue;
    const warning = layerStockWarning(project, layer, stockThicknessMm, cutsTabs);
    if (warning !== null) warnings.push(warning);
  }
  return warnings;
}

function layerStockWarning(
  project: Project,
  layer: Layer,
  stockThicknessMm: number,
  cutsTabs: (layer: Layer) => boolean,
): string | null {
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const throughCut = throughCutWarning(project, layer, settings, stockThicknessMm);
  if (throughCut !== null) return throughCut;
  if (settings.depthMm > stockThicknessMm && settings.cutType !== 'v-carve') {
    // Spoilboard overcut. Legitimate on purpose, so this informs and never
    // refuses; the free-part case above is the louder one and wins the row.
    const pastMm = settings.depthMm - stockThicknessMm;
    return (
      `Layer ${layer.id} cuts ${settings.depthMm} mm into ${stockThicknessMm} mm stock — ` +
      `${pastMm.toFixed(2)} mm past the bottom, into the spoilboard. ` +
      overcutTabNote(settings, stockThicknessMm, () => cutsTabs(layer)) +
      'Reduce the cut depth if that is not intended.'
    );
  }
  if (stockSkipsTabs(settings, stockThicknessMm)) {
    return (
      `${layer.name} skips its holding tabs: Stock thickness is ${formatMm(stockThicknessMm)} mm, ` +
      `so the ${formatMm(settings.depthMm)} mm cut leaves a ` +
      `${formatMm(stockThicknessMm - settings.depthMm)} mm floor that holds the part. ` +
      'If the material is thinner than that, the parts come free on the final pass — ' +
      'check Stock thickness before starting.'
    );
  }
  return null;
}

// A profile that reaches the stock bottom frees its parts on the final pass
// unless tabs hold them: with Tabs off, or (ADR-258 amendment 4) with tabs no
// shorter than the cut, which the compiler drops (passNeedsTabs). That second
// case names only operations that carry a closed shape, since an open path
// never takes a tab, and on a set stock it cannot happen: such a tab is thinned.
function throughCutWarning(
  project: Project,
  layer: Layer,
  settings: CncLayerSettings,
  stockThicknessMm: number,
): string | null {
  if (!isProfileCutType(settings.cutType) || settings.depthMm < stockThicknessMm) return null;
  const cut = `Layer ${layer.id} cuts through the stock (${settings.depthMm} mm ≥ ${stockThicknessMm} mm)`;
  const freed = 'the part and any hole slugs come free on the final pass.';
  if (!settings.tabsEnabled) {
    return `${cut} with no holding tabs — ${freed} Enable Tabs or reduce the cut depth.`;
  }
  const tabs = settingsWithStockTabGate(settings, stockThicknessMm);
  if (passNeedsTabs(-tabs.depthMm, tabs.depthMm, tabs.tabHeightMm)) return null;
  if (!layerCarriesClosedShape(project, layer)) return null;
  return (
    `${cut} with no holding tabs: its ${formatMm(settings.tabHeightMm)} mm tabs are no shorter ` +
    `than the cut, so none is cut — ${freed} Lower Tab height below the cut depth.`
  );
}

// ADR-258 amendment 3 (CNC audit TP-1): how much of each tab an overcut profile
// leaves in the stock. A set stock thickness keeps the full tab above the stock
// bottom, which relies on that thickness being right; the shipped default still
// measures from the cut floor, so the overcut eats into the tab. Amendment 4:
// silent unless the compiled passes rise into tabs, and a tab no thinner than
// the set stock says it was cut half the stock thick.
function overcutTabNote(
  settings: CncLayerSettings,
  stockThicknessMm: number,
  cutsTabs: () => boolean,
): string {
  if (!isProfileCutType(settings.cutType) || !settings.tabsEnabled) return '';
  const tabs = settingsWithStockTabGate(settings, stockThicknessMm);
  if (!tabs.tabsEnabled || !passNeedsTabs(-tabs.depthMm, tabs.depthMm, tabs.tabHeightMm)) {
    return '';
  }
  if (!cutsTabs()) return '';
  if (stockThicknessMm !== DEFAULT_CNC_STOCK.thicknessMm) {
    const keptMm = stockLimitedTabHeightMm(settings.tabHeightMm, stockThicknessMm);
    const thickness =
      keptMm < settings.tabHeightMm
        ? `are ${formatMm(keptMm)} mm thick above the stock bottom, thinned from the ` +
          `${formatMm(settings.tabHeightMm)} mm set to half the ${formatMm(stockThicknessMm)} mm stock`
        : `stay ${formatMm(settings.tabHeightMm)} mm thick above the stock bottom`;
    return `Its holding tabs ${thickness}, which relies on Stock thickness being right. `;
  }
  const inStockMm = stockThicknessMm + tabTopZMm(tabs.depthMm, tabs.tabHeightMm);
  return inStockMm > 0
    ? `Stock thickness is still the default, so its tabs are measured from the cut floor and only ` +
        `${formatMm(inStockMm)} mm of each is in the stock. Set Stock thickness to keep them full height. `
    : 'Stock thickness is still the default, so its tabs are measured from the cut floor and sit ' +
        'below the stock, and the part comes free. Set Stock thickness to keep them. ';
}

/** True when the compiler drops tabs this profile asks for (cnc-tabs.ts). */
function stockSkipsTabs(settings: CncLayerSettings, stockThicknessMm: number): boolean {
  return (
    isProfileCutType(settings.cutType) &&
    settings.tabsEnabled &&
    // No deeper than the tab, a pass never gets tabs anyway (passNeedsTabs).
    settings.depthMm > settings.tabHeightMm &&
    !cutCanFreePart(settings.depthMm, settings.tabHeightMm, stockThicknessMm)
  );
}

function layerCarriesClosedShape(project: Project, layer: Layer): boolean {
  const { polylines } = cncNoteContours(project.scene.objects, layer, project.device);
  return polylines.some((polyline) => polyline.closed);
}

function layerCarriesOnlyReliefs(project: Project, layer: Layer): boolean {
  const bound = project.scene.objects.filter((object) => sceneObjectUsesOperation(object, layer));
  const hasRelief = bound.some((object) => object.kind === 'relief');
  // Raster images do not contribute CNC depth geometry, so a relief plus a
  // display-only raster still leaves layer.depthMm stale for this advisory.
  const hasNonReliefCncGeometry = bound.some(
    (object) => object.kind !== 'relief' && object.kind !== 'raster-image',
  );
  return hasRelief && !hasNonReliefCncGeometry;
}
