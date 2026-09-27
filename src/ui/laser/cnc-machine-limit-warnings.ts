// CNC machine-limit advisories: compare configured spindle values even offline;
// compare travel, feed, plunge and controller S scale only with a live snapshot.
// Pure review information, never a gate or a measurement of physical motion/RPM.
// Stage recipes (ADR-457) emit their own feed, plunge and RPM, so a recipe whose
// cutter is in the tool library is compared too (ADR-457 Amd 1).

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncStock, type Project } from '../../core/scene';
import { CNC_CUTTING_STAGES, cncCuttingStageLabel } from '../../core/scene/cnc-stage-recipe';
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
  const top = maxOutputValue(project, 'feedMmPerMin');
  if (top === null || top.value <= axisLimit) return [];
  return [
    `${top.source}'s feed ${top.value} mm/min is above the machine's reported max rate ` +
      `${axisLimit} mm/min — the controller clamps to its limit, so the cut ` +
      'runs slower than planned.',
  ];
}

function plungeVsZMax(project: Project, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  if (limits.zMaxFeed === undefined) return [];
  const top = maxOutputValue(project, 'plungeMmPerMin');
  if (top === null || top.value <= limits.zMaxFeed) return [];
  return [
    `${top.source}'s plunge ${top.value} mm/min is above the machine's reported Z max rate ($112) ` +
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
  const top = maxOutputValue(project, 'spindleRpm');
  if (top === null || top.value <= ceiling) return [];
  return [
    `${top.source} requests spindle ${top.value} RPM but the machine's Spindle maximum is ` +
      `${ceiling} RPM — the compiled spindle setting is limited to ${ceiling} RPM; ` +
      'actual spindle RPM is not measured. Verify the controller-to-spindle scale.',
  ];
}

function spindleVsMax(project: Project, limits: ControllerSettingsSnapshot): ReadonlyArray<string> {
  if (limits.maxPowerS === undefined) return [];
  const top = maxOutputValue(project, 'spindleRpm');
  if (top === null || top.value <= limits.maxPowerS) return [];
  return [
    `${top.source} requests spindle ${top.value} RPM, above the machine's reported max ($30) ` +
      `${limits.maxPowerS} RPM. On GRBL, S commands above $30 use maximum PWM output; ` +
      'actual spindle RPM is not measured. Verify the controller-to-spindle scale.',
  ];
}

// The largest value of one CNC cutting setting among layers that actually emit
// (output on), including each layer's stage recipes whose cutter is in the tool
// library (a recipe for an absent cutter cannot emit). Null when no output
// layer exists: nothing to compare, so no advisory. A tie keeps the layer.
type CuttingValueKey = 'feedMmPerMin' | 'plungeMmPerMin' | 'spindleRpm';
type TopValue = { readonly value: number; readonly source: string };

function maxOutputValue(project: Project, key: CuttingValueKey): TopValue | null {
  const machine = project.machine;
  const toolIds = new Set(machine?.kind === 'cnc' ? machine.tools.map((tool) => tool.id) : []);
  const candidates: TopValue[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    const cnc = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    candidates.push({ value: cnc[key], source: 'A layer' });
    for (const stage of CNC_CUTTING_STAGES) {
      const recipe = cnc.stageRecipes?.[stage];
      if (recipe === undefined || !toolIds.has(recipe.toolId)) continue;
      candidates.push({ value: recipe[key], source: `The ${cncCuttingStageLabel(stage)} recipe` });
    }
  }
  return candidates.reduce<TopValue | null>(
    (top, candidate) => (top === null || candidate.value > top.value ? candidate : top),
    null,
  );
}
