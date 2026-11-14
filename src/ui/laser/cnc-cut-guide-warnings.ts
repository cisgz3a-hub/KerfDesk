// Job Review advisories that compare each compiled CNC group with its bit
// (ADR-233 Amendment 2). Advisory only; nothing here refuses a job.
//
// - Depth guide (CNC audit JR-5): a pass deeper than the bit's diameter, and,
//   for a bit with no recorded flute length, a cut deeper than three times its
//   diameter. With a recorded flute length the reach review compares the depth
//   with it exactly (cnc-program-reach.ts).
// - Low chip load (CNC audit FS-2): where the group's feeds came from a
//   material chart or a machine starter, a sent chip load under half the chart
//   value for that bit. A cap that holds the feed down makes the bit rub, which
//   heats and dulls it instead of cutting.
//
// Only flat and ball-nose cutters are compared: an angled bit's cutting width
// and chip load change with depth, and the chart does not describe it.

import {
  cncSpindleMinRpm,
  findCncMachineStarterById,
} from '../../core/cnc/cnc-machine-starter-catalog';
import { cncGroupMaximumDepthMm } from '../../core/cnc/cnc-group-maximum-depth';
import {
  chiploadFor,
  isChiploadMaterialKey,
  type ChiploadMaterial,
} from '../../core/cnc/feeds-calculator';
import { DEFAULT_ASSUMED_FLUTE_COUNT } from '../../core/cnc/machine-starters/resolve-cnc-auto-settings';
import { nominalChiploadMm } from '../../core/cnc/nominal-chipload';
import type { CncGroup, Job } from '../../core/job';
import type { CncTool, Project } from '../../core/scene';
import { cncCuttingStageLabel } from '../../core/scene/cnc-stage-recipe';

/** A cut deeper than this many diameters passes the flutes of most standard-length end mills. */
export const TYPICAL_FLUTE_LENGTH_DIAMETERS = 3;
/** Below this share of the chart chip load the bit rubs rather than cuts. */
export const LOW_CHIPLOAD_SHARE = 0.5;

export function detectCncCutGuideWarnings(project: Project, job: Job): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const warnings = new Set<string>();
  const spindleMinRpm = cncSpindleMinRpm(project.device);
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.passes.length === 0 || !comparable(group)) continue;
    const source = sourceName(project, group);
    const tool = machine.tools.find((candidate) => candidate.id === group.toolId);
    for (const warning of depthGuide(group, tool, source)) warnings.add(warning);
    const low = lowChipload(group, source, spindleMinRpm);
    if (low !== null) warnings.add(low);
  }
  return [...warnings];
}

function comparable(group: CncGroup): boolean {
  const kind = group.toolKind ?? 'end-mill';
  return (kind === 'end-mill' || kind === 'ball-nose') && group.toolDiameterMm > 0;
}

function depthGuide(group: CncGroup, tool: CncTool | undefined, source: string): string[] {
  const diameter = group.toolDiameterMm;
  const out: string[] = [];
  const perPass = group.depthPerPassMm;
  if (group.cutType !== 'drill' && perPass !== undefined && perPass > diameter) {
    out.push(
      `${source} takes ${mm(perPass)} mm per pass with a ${mm(diameter)} mm bit, more than its ` +
        'diameter. The usual guide is up to half the diameter per pass in wood and less in ' +
        'harder materials; a deeper pass overloads the bit and can snap it.',
    );
  }
  const depth = cncGroupMaximumDepthMm(group);
  const guide = TYPICAL_FLUTE_LENGTH_DIAMETERS * diameter;
  if (tool?.fluteLengthMm === undefined && Number.isFinite(depth) && depth > guide) {
    out.push(
      `${source} cuts ${mm(depth)} mm deep with a ${mm(diameter)} mm bit, more than three times ` +
        'its diameter. A standard-length end mill\'s flutes are about that long (a regular 1/8" ' +
        'end mill has 3/8" to 1/2"), so the shank may rub the wall or the bit may not reach. ' +
        "Record the bit's flute length in the bit library and Job Review checks it exactly.",
    );
  }
  return out;
}

function lowChipload(
  group: CncGroup,
  source: string,
  spindleMinRpm: number | undefined,
): string | null {
  if (group.cutType === 'drill') return null;
  const material = chartMaterial(group);
  if (material === null) return null;
  const flutes = group.toolFluteCount ?? recipeFlutes(group) ?? DEFAULT_ASSUMED_FLUTE_COUNT;
  const sent = nominalChiploadMm(group.feedMmPerMin, group.spindleRpm, flutes);
  const chart = chiploadFor(material, group.toolDiameterMm);
  if (sent === null || !(chart > 0) || sent >= LOW_CHIPLOAD_SHARE * chart) return null;
  return (
    `${source} cuts at ${sent.toFixed(4)} mm/tooth, ${Math.round((sent / chart) * 100)}% of the ` +
    `${chart.toFixed(4)} mm/tooth the material chart gives a ${mm(group.toolDiameterMm)} mm bit ` +
    `(${Math.round(group.feedMmPerMin)} mm/min at ${Math.round(group.spindleRpm)} RPM, ${flutes} ` +
    `flutes). At that chip load the bit rubs instead of cutting, which heats and dulls it: ${lowChiploadAdvice(group, spindleMinRpm)}`
  );
}

// CNC audit v3 N7r-P3-1: at the spindle's rated minimum (ADR-256 Amd 1) a lower
// speed is not on offer, so the advice names what is left.
function lowChiploadAdvice(group: CncGroup, spindleMinRpm: number | undefined): string {
  if (spindleMinRpm === undefined || group.spindleRpm > spindleMinRpm) {
    return 'raise the feed, or lower the spindle speed, until it is nearer the chart.';
  }
  return (
    `the spindle is already at its ${spindleMinRpm} RPM minimum, so raise the feed if the ` +
    'machine can take it, or use a smaller bit, whose chart chip load is lower.'
  );
}

function chartMaterial(group: CncGroup): ChiploadMaterial | null {
  const feedSource = group.feedSource;
  if (feedSource?.kind === 'material-recipe') {
    return isChiploadMaterialKey(feedSource.materialKey) ? feedSource.materialKey : null;
  }
  if (feedSource?.kind === 'machine-starter') {
    return findCncMachineStarterById(feedSource.starterId)?.material.key ?? null;
  }
  return null;
}

function recipeFlutes(group: CncGroup): number | undefined {
  return group.feedSource?.kind === 'material-recipe' ? group.feedSource.fluteCount : undefined;
}

function sourceName(project: Project, group: CncGroup): string {
  const name =
    project.scene.layers.find((layer) => layer.id === group.layerId)?.name ?? group.layerId;
  return group.cuttingStage === undefined
    ? `Layer "${name}"`
    : `The ${cncCuttingStageLabel(group.cuttingStage)} recipe on layer "${name}"`;
}

function mm(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
