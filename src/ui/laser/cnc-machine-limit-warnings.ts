// detectCncMachineLimitWarnings — CNC advisories that only a CONNECTED
// controller can raise, comparing the job against the machine's live-reported
// `$$` limits: stock overhanging the reported travel ($130/$131), a layer feed
// above the SLOWER reported axis rate ($110/$111), a layer plunge above the
// reported Z max rate ($112), and a layer spindle RPM above the reported $30
// max. Advisory, never a gate — an operator who knows their real work area or
// accepts firmware clamping may still proceed. Pure: the detected snapshot is
// passed in (the laser store owns it), distinct from detectCncStockWarnings
// (toolpaths vs the stock footprint) so each file keeps a single
// responsibility.

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type CncStock,
  type Project,
} from '../../core/scene';
import { reportedAxisFeedLimit } from './reported-axis-feed-limit';

export function detectCncMachineLimitWarnings(
  project: Project,
  limits: ControllerSettingsSnapshot | null,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (limits === null || machine === undefined || machine.kind !== 'cnc') return [];
  return [
    ...stockVsBed(machine.stock, limits),
    ...feedVsMax(project, limits),
    ...plungeVsZMax(project, limits),
    ...spindleVsMax(project, limits),
  ];
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
  const axisLimit = reportedAxisFeedLimit(limits);
  if (axisLimit === null) return [];
  const topFeed = maxOutputLayerValue(project, (cnc) => cnc.feedMmPerMin);
  if (topFeed === null || topFeed <= axisLimit) return [];
  return [
    `A layer's feed ${topFeed} mm/min is above the machine's reported max rate ` +
      `${axisLimit} mm/min — the controller clamps to its limit, so the cut ` +
      'runs slower than planned.',
  ];
}

function plungeVsZMax(project: Project, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  if (limits.zMaxFeed === undefined) return [];
  const topPlunge = maxOutputLayerValue(project, (cnc) => cnc.plungeMmPerMin);
  if (topPlunge === null || topPlunge <= limits.zMaxFeed) return [];
  return [
    `A layer's plunge ${topPlunge} mm/min is above the machine's reported Z max rate ($112) ` +
      `${limits.zMaxFeed} mm/min — the controller clamps to its limit, so plunges ` +
      'run slower than planned.',
  ];
}

function spindleVsMax(project: Project, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  if (limits.maxPowerS === undefined) return [];
  const topRpm = maxOutputLayerValue(project, (cnc) => cnc.spindleRpm);
  if (topRpm === null || topRpm <= limits.maxPowerS) return [];
  return [
    `A layer's spindle ${topRpm} RPM is above the machine's reported max ($30) ` +
      `${limits.maxPowerS} RPM — the controller caps the S output, so the spindle ` +
      'spins slower than the feeds assume.',
  ];
}

// The largest value of one CNC setting among layers that actually emit (output
// on). Null when no output layer exists — nothing to compare, so no advisory.
function maxOutputLayerValue(
  project: Project,
  pick: (cnc: CncLayerSettings) => number,
): number | null {
  const values = project.scene.layers
    .filter((layer) => layer.output)
    .map((layer) => pick(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS));
  return values.length === 0 ? null : Math.max(...values);
}
