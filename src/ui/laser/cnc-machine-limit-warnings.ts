// CNC machine-limit advisories: compare configured spindle values even offline;
// compare travel, feed, plunge and controller S scale only with a live snapshot.
// Pure review information, never a gate or a measurement of physical motion/RPM.

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
  if (machine === undefined || machine.kind !== 'cnc') return [];
  if (limits === null) return spindleVsConfiguredCeiling(project);
  return [
    ...stockVsBed(machine.stock, limits),
    ...feedVsMax(project, limits),
    ...plungeVsZMax(project, limits),
    ...spindleVsMax(project, limits),
    ...spindleVsConfiguredCeiling(project),
  ];
}

// Compare the stock's FAR EDGE against travel, not its raw size: stock placed
// at an origin offset reaches originOffset + size, so a 300 mm sheet at (150,
// 150) runs 50 mm past a 400 mm axis while its width alone looks in range. The
// sibling detector already works in extents (cnc-stock-warnings.ts).
function stockVsBed(stock: CncStock, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  const maxX = stock.originOffset.x + stock.widthMm;
  const maxY = stock.originOffset.y + stock.heightMm;
  const over: string[] = [];
  if (limits.bedWidth !== undefined && maxX > limits.bedWidth) {
    over.push(`X reaches ${maxX} mm > ${limits.bedWidth} mm`);
  }
  if (limits.bedHeight !== undefined && maxY > limits.bedHeight) {
    over.push(`Y reaches ${maxY} mm > ${limits.bedHeight} mm`);
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

// The app's OWN configured ceiling, distinct from the controller's reported $30
// above. capSpindle limits the compiled setting, not measured physical RPM.
// Preflight used to refuse this outright; it is an advisory now.
function spindleVsConfiguredCeiling(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  const ceiling = machine.params.spindleMaxRpm;
  const topRpm = maxOutputLayerValue(project, (cnc) => cnc.spindleRpm);
  if (topRpm === null || topRpm <= ceiling) return [];
  return [
    `A layer requests spindle ${topRpm} RPM but the machine's Spindle maximum is ` +
      `${ceiling} RPM — the compiled spindle setting is limited to ${ceiling} RPM; ` +
      'actual spindle RPM is not measured. Verify the controller-to-spindle scale.',
  ];
}

function spindleVsMax(project: Project, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  if (limits.maxPowerS === undefined) return [];
  const topRpm = maxOutputLayerValue(project, (cnc) => cnc.spindleRpm);
  if (topRpm === null || topRpm <= limits.maxPowerS) return [];
  return [
    `A layer requests spindle ${topRpm} RPM, above the machine's reported max ($30) ` +
      `${limits.maxPowerS} RPM. On GRBL, S commands above $30 use maximum PWM output; ` +
      'actual spindle RPM is not measured. Verify the controller-to-spindle scale.',
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
