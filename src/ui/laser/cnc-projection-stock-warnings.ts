// Stock-bottom advisories for a relief projection (rolling audit v11 W6-P2-1).
//
// A projected operation cuts its Vertical depth under the relief surface, so
// the layer's Cut depth says nothing about where it ends: judged on it, a 3 mm
// projection 1 mm into the spoilboard went unreported and a stale Cut depth
// reported a spoilboard cut that never happened. These read the compiled
// projection instead: closed shapes cut through all the way round with no
// tab (the part comes free), a cut past the stock bottom, and tabs the floor
// made unnecessary. Advisory only, as detectCncThroughCutTabWarnings is.

import { isProfileCutType } from '../../core/cnc';
import type { CncLayerSettings, CncStock, Layer } from '../../core/scene';
// Deep import: core/scene's barrel is a ratcheted over-cap legacy barrel.
import { setStockThicknessMm } from '../../core/scene/machine';
import {
  projectionSetTabHeightMm,
  projectionTabsThin,
  type CompiledProjectionFacts,
} from './job-review/job-review-projection-detail';

// Bridges thinner than this are named as likely to break (X6-P1-1).
const THIN_TAB_MM = 1;
import { formatMm } from './job-review/job-review-format';

export function projectionStockWarning(
  layer: Layer,
  settings: CncLayerSettings,
  facts: CompiledProjectionFacts | undefined,
  stock: CncStock,
): string | null {
  if (facts === undefined) return null;
  const stockThicknessMm = stock.thicknessMm;
  // ADR-258 Amendment 6: the tab rules read the SET thickness, undefined while
  // the operator has not set one; the stock text reads the thickness shown.
  const setMm = setStockThicknessMm(stock);
  const cut =
    `Layer ${layer.id} projects ${formatMm(facts.verticalDepthMm)} mm under the relief surface ` +
    `and reaches ${formatMm(facts.deepestMm)} mm into ${stockThicknessMm} mm stock`;
  if (facts.freedShapes > 0) {
    const shapes = `${facts.freedShapes} closed ${facts.freedShapes === 1 ? 'shape' : 'shapes'}`;
    const fix = !settings.tabsEnabled
      ? 'Enable Tabs or reduce the Vertical depth.'
      : setMm === undefined
        ? 'Stock thickness has not been set, so its tabs are measured from the cut floor and sit ' +
          'below the stock. Set Stock thickness in Machine Setup (press Use 6.35 mm there if ' +
          'that is the real sheet) to keep them.'
        : // X6-P1-1: tabs on and set, yet nothing holds: the relief floor
          // under the windows is at the stock bottom, so they ride in air.
          'Its tab windows leave no more than 0.1 mm, because the relief floor under them is ' +
          'already at the stock bottom. Raise the relief floor there, use thicker stock, or ' +
          'hold the parts down.';
    return (
      `${cut}: it cuts ${shapes} through the stock all the way round with no holding tab — ` +
      `the parts come free on the final pass. ${fix}`
    );
  }
  const thin = projectionTabsThin(settings, facts, setMm);
  if (thin !== null) {
    const tabMm = projectionSetTabHeightMm(settings, setMm);
    return (
      `${cut}${pastBottom(facts, stockThicknessMm)}: its holding tabs are only ` +
      `${formatMm(thin)} mm thick, not the ${formatMm(tabMm)} mm ` +
      `set, because the relief floor under them stands only ${formatMm(thin)} mm above the ` +
      'stock bottom and a tab keeps only the material there. ' +
      (thin < THIN_TAB_MM ? 'Tabs this thin can break and free the parts. ' : '') +
      'Raise the relief floor at the tabs, use thicker stock, or hold the parts down.'
    );
  }
  if (facts.deepestMm > stockThicknessMm + 1e-6) {
    return (
      `${cut} — ${(facts.deepestMm - stockThicknessMm).toFixed(2)} mm past the bottom, into the ` +
      'spoilboard. Reduce the Vertical depth if that is not intended.'
    );
  }
  // An unset thickness drops no tab for a floor (ADR-258 Amendment 6).
  if (setMm !== undefined && projectionSkipsTabs(settings, facts)) {
    return (
      `${layer.name} skips its holding tabs: Stock thickness is ${formatMm(stockThicknessMm)} mm, ` +
      `so the deepest projected cut at ${formatMm(facts.deepestMm)} mm leaves a ` +
      `${formatMm(stockThicknessMm - facts.deepestMm)} mm floor that holds the part. If the ` +
      'material is thinner than that, the parts come free on the final pass — check Stock ' +
      'thickness before starting.'
    );
  }
  return null;
}

// The spoilboard fact, kept in the louder thin-tab note.
function pastBottom(facts: CompiledProjectionFacts, stockThicknessMm: number): string {
  return facts.deepestMm > stockThicknessMm + 1e-6
    ? ` — ${(facts.deepestMm - stockThicknessMm).toFixed(2)} mm past the bottom, into the spoilboard`
    : '';
}

// A projected profile whose closed shapes asked for tabs and got none because
// the floor under the deepest projected cut holds them.
function projectionSkipsTabs(
  settings: CncLayerSettings,
  facts: CompiledProjectionFacts | undefined,
): boolean {
  return (
    facts !== undefined &&
    isProfileCutType(settings.cutType) &&
    settings.tabsEnabled &&
    facts.closedShapes > 0 &&
    facts.tabbedShapes === 0 &&
    facts.freedShapes === 0
  );
}
