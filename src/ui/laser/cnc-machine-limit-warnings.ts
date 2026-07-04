// detectCncMachineLimitWarnings — CNC advisories that only a CONNECTED
// controller can raise, comparing the job against the machine's live-reported
// `$$` limits: stock overhanging the reported travel ($130/$131), and a layer
// feed above the reported max rate ($110/$111 → maxFeed). Advisory, never a
// gate — an operator who knows their real work area or accepts firmware
// clamping may still proceed. Pure: the detected snapshot is passed in (the
// laser store owns it), distinct from detectCncStockWarnings (toolpaths vs the
// stock footprint) so each file keeps a single responsibility.

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncStock, type Project } from '../../core/scene';

export function detectCncMachineLimitWarnings(
  project: Project,
  limits: ControllerSettingsSnapshot | null,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (limits === null || machine === undefined || machine.kind !== 'cnc') return [];
  return [...stockVsBed(machine.stock, limits), ...feedVsMax(project, limits)];
}

function stockVsBed(stock: CncStock, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  const over: string[] = [];
  if (limits.bedWidth !== undefined && stock.widthMm > limits.bedWidth) {
    over.push(`width ${stock.widthMm} mm > ${limits.bedWidth} mm`);
  }
  if (limits.bedHeight !== undefined && stock.heightMm > limits.bedHeight) {
    over.push(`height ${stock.heightMm} mm > ${limits.bedHeight} mm`);
  }
  if (over.length === 0) return [];
  return [
    `Stock exceeds the machine's reported travel (${over.join(', ')}) — ` +
      'the bit cannot reach the whole workpiece.',
  ];
}

function feedVsMax(project: Project, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  if (limits.maxFeed === undefined) return [];
  const topFeed = maxOutputLayerFeed(project);
  if (topFeed === null || topFeed <= limits.maxFeed) return [];
  return [
    `A layer's feed ${topFeed} mm/min is above the machine's reported max rate ` +
      `${limits.maxFeed} mm/min — the controller clamps to its limit, so the cut ` +
      'runs slower than planned.',
  ];
}

// The fastest XY feed among layers that actually emit (output on). Null when no
// output layer exists — nothing to compare, so no advisory.
function maxOutputLayerFeed(project: Project): number | null {
  const feeds = project.scene.layers
    .filter((layer) => layer.output)
    .map((layer) => (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).feedMmPerMin);
  return feeds.length === 0 ? null : Math.max(...feeds);
}
