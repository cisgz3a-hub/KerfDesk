// CNC machine-limit advisories: compare configured spindle values even offline;
// compare travel, feed, plunge and controller S scale only with a live snapshot.
// Pure review information, never a gate or a measurement of physical motion/RPM.
// Stage recipes (ADR-457) emit their own feed, plunge and RPM, so a recipe the
// job runs is compared too and named with its layer (ADR-457 Amd 1 and 2).
//
// The values compared are the ones the program sends (CNC audit v3 N6-P3-2):
// with the compiled job, each cutting group's own words; without it, each
// output layer that has artwork, worked out the way the compiler would. A layer
// with no artwork sends nothing, and a drill cycle sends no XY cutting feed.

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { cncMaxFeedMmPerMin } from '../../core/cnc/cnc-head-feeds';
import { cncSpindleMinRpm } from '../../core/cnc/cnc-machine-starter-catalog';
import { cncCuttingRates } from '../../core/cnc/cnc-cutting-rates';
import { cncStageRecipeRuns } from '../../core/cnc/cnc-stage-recipe-runs';
import { effectiveGcodeFeedMmPerMin } from '../../core/gcode/feed-word';
import type { CncGroup, Job } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  sceneObjectUsesOperation,
  type CncCutType,
  type CncMachineConfig,
  type CncStock,
  type Project,
} from '../../core/scene';
import { CNC_CUTTING_STAGES, cncCuttingStageLabel } from '../../core/scene/cnc-stage-recipe';
import { reportedAxisFeedLimit } from './reported-axis-feed-limit';

/** One operation's sent cutting words, named for the operator. */
type CuttingRow = {
  readonly source: string;
  /** Null for a drill cycle, whose moves are all vertical at the plunge feed. */
  readonly feedMmPerMin: number | null;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly spindleCap?: CncGroup['spindleCap'];
};

export function detectCncMachineLimitWarnings(
  project: Project,
  limits: ControllerSettingsSnapshot | null,
  job?: Job,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  const rows = job === undefined ? layerRows(project, machine) : groupRows(project, job);
  const belowMinimum = spindleBelowMinimum(project, rows);
  if (limits === null) return [...spindleVsConfiguredCeiling(machine, rows), ...belowMinimum];
  return [
    ...stockVsBed(machine.stock, limits),
    ...feedVsMax(rows, limits),
    ...plungeVsZMax(rows, limits),
    ...spindleVsMax(rows, limits),
    ...spindleVsConfiguredCeiling(machine, rows),
    ...belowMinimum,
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

function feedVsMax(
  rows: ReadonlyArray<CuttingRow>,
  limits: ControllerSettingsSnapshot,
): ReadonlyArray<string> {
  const axisLimit = reportedAxisFeedLimit(limits);
  if (axisLimit === null) return [];
  const top = topRow(rows, (row) => row.feedMmPerMin);
  if (top === null || top.value <= axisLimit) return [];
  return [
    `${top.row.source} requests feed ${feedText(top.value)} mm/min, above the machine's reported max rate ` +
      `${axisLimit} mm/min — the controller clamps to its limit, so the cut ` +
      'runs slower than planned.',
  ];
}

function plungeVsZMax(
  rows: ReadonlyArray<CuttingRow>,
  limits: ControllerSettingsSnapshot,
): ReadonlyArray<string> {
  if (limits.zMaxFeed === undefined) return [];
  const top = topRow(rows, (row) => row.plungeMmPerMin);
  if (top === null || top.value <= limits.zMaxFeed) return [];
  return [
    `${top.row.source} requests plunge ${feedText(top.value)} mm/min, above the machine's reported Z max rate ($112) ` +
      `${limits.zMaxFeed} mm/min — the controller clamps to its limit, so plunges ` +
      'run slower than planned.',
  ];
}

// The app's OWN configured ceiling, distinct from the controller's reported $30
// below. Preflight used to refuse this outright; it is an advisory now, and
// since ADR-233 Amd 1 the compiler scales the feeds with the capped S, so the
// chip load holds and the cut runs slower. Say exactly that.
function spindleVsConfiguredCeiling(
  machine: CncMachineConfig,
  rows: ReadonlyArray<CuttingRow>,
): ReadonlyArray<string> {
  const top = topRow(rows, (row) => row.spindleCap?.requestedRpm ?? null);
  const cap = top?.row.spindleCap;
  if (top === null || cap === undefined) return [];
  const ceiling = machine.params.spindleMaxRpm;
  const feed =
    top.row.feedMmPerMin === null
      ? ''
      : `feed from ${feedText(cap.requestedFeedMmPerMin)} to ${feedText(top.row.feedMmPerMin)} mm/min and `;
  return [
    `${top.row.source} requests spindle ${cap.requestedRpm} RPM but the machine's Spindle maximum is ` +
      `${ceiling} RPM — the program sends S${ceiling} and lowers its ${feed}plunge from ` +
      `${feedText(cap.requestedPlungeMmPerMin)} to ${feedText(top.row.plungeMmPerMin)} mm/min ` +
      `by the same ratio, so each tooth keeps the chip load planned at ${cap.requestedRpm} RPM and ` +
      `the cut runs slower. To plan at the speed the machine runs, set the spindle to ${ceiling} RPM ` +
      'or reapply the material. KerfDesk sends the S value only; actual spindle RPM is not measured.',
  ];
}

// CNC audit v3 N7r-P3-1: where the machine's starter records its spindle's
// lowest rated speed (ADR-256 Amd 1: 3,000 RPM on the 4040's 500 W spindle), a
// slower S, typed by hand, is named. A 0 RPM spindle is refused by preflight.
function spindleBelowMinimum(
  project: Project,
  rows: ReadonlyArray<CuttingRow>,
): ReadonlyArray<string> {
  const minimum = cncSpindleMinRpm(project.device);
  if (minimum === undefined) return [];
  let slowest: CuttingRow | null = null;
  for (const row of rows) {
    if (row.spindleRpm <= 0 || row.spindleRpm >= minimum) continue;
    if (slowest === null || row.spindleRpm < slowest.spindleRpm) slowest = row;
  }
  if (slowest === null) return [];
  return [
    `${slowest.source} runs the spindle at ${slowest.spindleRpm} RPM, below the ${minimum} RPM ` +
      'minimum of the spindle this machine profile assumes. Below its rated range a spindle loses ' +
      `torque and can stall in the cut. Set at least ${minimum} RPM, or confirm the fitted ` +
      'spindle runs that slow.',
  ];
}

// GRBL takes `$30` as the S value for full output (ADR-362 item 6), so it is
// not always an RPM: a hybrid laser reports 1000. The program is compiled
// without it, so its feeds are the ones planned at the sent S. When `$30` is the
// spindle's real top speed, each tooth takes S / $30 times the planned chip load.
function spindleVsMax(
  rows: ReadonlyArray<CuttingRow>,
  limits: ControllerSettingsSnapshot,
): ReadonlyArray<string> {
  const maxS = limits.maxPowerS;
  if (maxS === undefined) return [];
  const top = topRow(rows, (row) => row.spindleRpm);
  if (top === null || top.value <= maxS) return [];
  const ratio = top.value / maxS;
  return [
    `${top.row.source} requests spindle ${top.value} RPM, above the machine's reported max ($30) ` +
      `${maxS} RPM. On GRBL, S commands above $30 use maximum PWM output. If ${maxS} RPM is the ` +
      `spindle's real top speed, the feeds stay as planned at ${top.value} RPM, so each tooth takes ` +
      `${ratio.toFixed(1)}× the planned chip load: set Spindle maximum to ${maxS} RPM in Machine ` +
      'Setup and KerfDesk lowers the feeds to match; actual spindle RPM is not measured.',
  ];
}

// The largest value among the rows; a tie keeps the earlier row, so a layer
// is named before its own recipes. Null when no row has a value.
function topRow(
  rows: ReadonlyArray<CuttingRow>,
  pick: (row: CuttingRow) => number | null,
): { readonly row: CuttingRow; readonly value: number } | null {
  let top: { readonly row: CuttingRow; readonly value: number } | null = null;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null && (top === null || value > top.value)) top = { row, value };
  }
  return top;
}

function feedText(feedMmPerMin: number): string {
  return String(effectiveGcodeFeedMmPerMin(feedMmPerMin));
}

// With the compiled job: each cutting group as the program sends it.
function groupRows(project: Project, job: Job): ReadonlyArray<CuttingRow> {
  const rows: CuttingRow[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.passes.length === 0) continue;
    const name =
      project.scene.layers.find((layer) => layer.id === group.layerId)?.name ?? group.layerId;
    rows.push({
      source:
        group.cuttingStage === undefined
          ? `Layer "${name}"`
          : `The ${cncCuttingStageLabel(group.cuttingStage)} recipe on layer "${name}"`,
      feedMmPerMin: group.cutType === 'drill' ? null : group.feedMmPerMin,
      plungeMmPerMin: group.plungeMmPerMin,
      spindleRpm: group.spindleRpm,
      ...(group.spindleCap === undefined ? {} : { spindleCap: group.spindleCap }),
    });
  }
  return rows;
}

// Without it: every output layer with artwork, and the stage recipes it can
// run, through the compiler's own rate rule (cncCuttingRates).
function layerRows(project: Project, machine: CncMachineConfig): ReadonlyArray<CuttingRow> {
  const runs = cncStageRecipeRuns(machine, undefined);
  const maxFeed = cncMaxFeedMmPerMin(project.device, machine.params);
  const rate = (
    source: string,
    cutType: CncCutType,
    values: { feedMmPerMin: number; plungeMmPerMin: number; spindleRpm: number },
  ): CuttingRow => {
    const drill = cutType === 'drill';
    const rates = cncCuttingRates(
      { ...values, feedMmPerMin: drill ? values.plungeMmPerMin : values.feedMmPerMin },
      maxFeed,
      machine.params.spindleMaxRpm,
    );
    return {
      source,
      feedMmPerMin: drill ? null : rates.feedMmPerMin,
      plungeMmPerMin: rates.plungeMmPerMin,
      spindleRpm: rates.spindleRpm,
      ...(rates.spindleCap === undefined ? {} : { spindleCap: rates.spindleCap }),
    };
  };
  const rows: CuttingRow[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    if (!project.scene.objects.some((object) => sceneObjectUsesOperation(object, layer))) continue;
    const cnc = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    rows.push(rate(`Layer "${layer.name}"`, cnc.cutType, cnc));
    for (const stage of CNC_CUTTING_STAGES) {
      const recipe = cnc.stageRecipes?.[stage];
      if (recipe === undefined || !runs(layer.id, stage, recipe.toolId)) continue;
      const source = `The ${cncCuttingStageLabel(stage)} recipe on layer "${layer.name}"`;
      rows.push(rate(source, cnc.cutType, recipe));
    }
  }
  return rows;
}
