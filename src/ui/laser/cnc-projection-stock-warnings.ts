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
import { DEFAULT_CNC_STOCK, type CncLayerSettings, type Layer } from '../../core/scene';
import type { CompiledProjectionFacts } from './job-review/job-review-projection-detail';
import { formatMm } from './job-review/job-review-format';

export function projectionStockWarning(
  layer: Layer,
  settings: CncLayerSettings,
  facts: CompiledProjectionFacts | undefined,
  stockThicknessMm: number,
): string | null {
  if (facts === undefined) return null;
  const cut =
    `Layer ${layer.id} projects ${formatMm(facts.verticalDepthMm)} mm under the relief surface ` +
    `and reaches ${formatMm(facts.deepestMm)} mm into ${stockThicknessMm} mm stock`;
  if (facts.freedShapes > 0) {
    const shapes = `${facts.freedShapes} closed ${facts.freedShapes === 1 ? 'shape' : 'shapes'}`;
    const fix = !settings.tabsEnabled
      ? 'Enable Tabs or reduce the Vertical depth.'
      : stockThicknessMm === DEFAULT_CNC_STOCK.thicknessMm
        ? 'Stock thickness is still the default, so its tabs are measured from the cut floor and sit below the stock. Set Stock thickness to keep them.'
        : 'Reduce the Vertical depth or Tab height.';
    return (
      `${cut}: it cuts ${shapes} through the stock all the way round with no holding tab — ` +
      `the parts come free on the final pass. ${fix}`
    );
  }
  if (facts.deepestMm > stockThicknessMm + 1e-6) {
    return (
      `${cut} — ${(facts.deepestMm - stockThicknessMm).toFixed(2)} mm past the bottom, into the ` +
      'spoilboard. Reduce the Vertical depth if that is not intended.'
    );
  }
  // The shipped thickness reads as never set, and then no floor drops a tab.
  if (stockThicknessMm !== DEFAULT_CNC_STOCK.thicknessMm && projectionSkipsTabs(settings, facts)) {
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
