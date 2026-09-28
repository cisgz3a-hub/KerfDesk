import type { CncGroup, CncPass, Group, Job } from '../../../core/job';
import { cncGroupMaximumDepth, cncPassCanEmit } from '../../../core/cnc/output-representation';
import {
  type CncCoordinateRepresentation,
  representedCncCoordinateMm,
  requestedCncCoordinateText,
} from '../../../core/cnc/coordinate-representation';
import { artworkOperationName, type Layer, type SceneObject } from '../../../core/scene';
import {
  laserOperationDetail,
  type CompiledReliefFacts,
  type PlungingReliefStage,
} from './job-review-detail-facts';
import { tabSpanGroupLabel } from './job-review-laser-tabs';

import { cncCuttingStageLabel } from '../../../core/scene/cnc-stage-recipe';
import { nominalChiploadMm } from '../../../core/cnc/nominal-chipload';
import { effectiveGcodeFeedMmPerMin } from '../../../core/gcode/feed-word';

export type JobReviewEffectiveOperation = {
  readonly layerId: string;
  readonly summaries: ReadonlyArray<string>;
  readonly cncActualMaxDepthMm?: number;
  readonly plungingReliefStages?: ReadonlyArray<PlungingReliefStage>;
  readonly relief?: CompiledReliefFacts;
  // Set when the operation asks for a ramp and compiled shapes other than
  // reliefs, none of whose groups records one (ADR-273 Amendment 2).
  readonly unrampedShapes?: true;
};

/** Summarize selected values from the exact prepared Job. Matching displayed
 * summaries within one operation are combined; they do not establish complete group identity. */
export function buildEffectiveOperationReview(
  job: Job,
  scene?: {
    readonly objects: ReadonlyArray<SceneObject>;
    readonly layers: ReadonlyArray<Layer>;
  },
): ReadonlyArray<JobReviewEffectiveOperation> {
  const summariesByLayer = new Map<string, string[]>();
  const vCarveDepthByLayer = new Map<string, CncCoordinateRepresentation>();
  for (const group of job.groups) {
    const summary = effectiveGroupSummary(group, scene);
    const summaries = summariesByLayer.get(group.layerId) ?? [];
    if (!summaries.includes(summary)) summaries.push(summary);
    summariesByLayer.set(group.layerId, summaries);
    if (group.kind === 'cnc' && group.cutType === 'v-carve') {
      const candidate = cncGroupMaximumDepth(group);
      const current = vCarveDepthByLayer.get(group.layerId);
      if (current === undefined || candidate.value > current.value) {
        vCarveDepthByLayer.set(group.layerId, candidate);
      }
    }
  }
  const plungingReliefByLayer = plungingReliefStagesByLayer(job);
  const reliefByLayer = compiledReliefFactsByLayer(job);
  const unrampedShapeLayers = unrampedShapeLayerIds(job, scene?.layers ?? []);
  return [...summariesByLayer].map(([layerId, summaries]) => {
    const cncActualMaxDepth = vCarveDepthByLayer.get(layerId);
    const plungingReliefStages = plungingReliefByLayer.get(layerId);
    const relief = reliefByLayer.get(layerId);
    return {
      layerId,
      summaries,
      ...(cncActualMaxDepth === undefined ? {} : { cncActualMaxDepthMm: cncActualMaxDepth.value }),
      ...(plungingReliefStages === undefined ? {} : { plungingReliefStages }),
      ...(relief === undefined ? {} : { relief }),
      ...(unrampedShapeLayers.has(layerId) ? { unrampedShapes: true as const } : {}),
    };
  });
}

// A relief group records a ramp only where it ramps (ADR-273 Amendment 1), so
// one without it plunges at every start, whatever entry its layer asks for.
function plungingReliefStagesByLayer(
  job: Job,
): ReadonlyMap<string, ReadonlyArray<PlungingReliefStage>> {
  const byLayer = new Map<string, PlungingReliefStage[]>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.rampEntryDeg !== undefined) continue;
    if (group.cutType !== 'relief-rough' && group.cutType !== 'relief-finish') continue;
    const stages = byLayer.get(group.layerId) ?? [];
    if (!stages.includes(group.cutType)) stages.push(group.cutType);
    byLayer.set(group.layerId, stages);
  }
  return byLayer;
}

// ADR-224 Amendment 3: a relief roughs to its own depth, level by level, and
// takes no tabs, so the operation line reads from the compiled groups which
// levels the reliefs cut and whether any other shape was cut beside them.
function compiledReliefFactsByLayer(job: Job): ReadonlyMap<string, CompiledReliefFacts> {
  const levelsByLayer = new Map<string, Set<number>>();
  const maxDepthByLayer = new Map<string, number>();
  const otherShapeLayers = new Set<string>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    if (group.cutType !== 'relief-rough' && group.cutType !== 'relief-finish') {
      otherShapeLayers.add(group.layerId);
      continue;
    }
    const levels = levelsByLayer.get(group.layerId) ?? new Set<number>();
    if (group.cutType === 'relief-rough') addRoughingLevels(levels, group);
    levelsByLayer.set(group.layerId, levels);
    // Amendment 4: finishing cuts the allowance roughing leaves, so it can
    // reach deeper than the deepest roughing level.
    const depthMm = cncGroupMaximumDepth(group).value;
    maxDepthByLayer.set(group.layerId, Math.max(maxDepthByLayer.get(group.layerId) ?? 0, depthMm));
  }
  const reliefCounts = compiledReliefCounts(job);
  const facts = new Map<string, CompiledReliefFacts>();
  for (const [layerId, levels] of levelsByLayer) {
    facts.set(layerId, {
      roughingLevelDepthsMm: [...levels].sort((a, b) => a - b),
      reliefCount: reliefCounts.get(layerId) ?? 0,
      maxDepthMm: maxDepthByLayer.get(layerId) ?? 0,
      cutsOtherShapes: otherShapeLayers.has(layerId),
    });
  }
  return facts;
}

// The job's relief planning evidence holds one roughing entry per compiled
// relief; a legacy job without it counts none.
function compiledReliefCounts(job: Job): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const plan of job.cncCompilation?.reliefPlans ?? []) {
    if (plan.stage === 'roughing') counts.set(plan.layerId, (counts.get(plan.layerId) ?? 0) + 1);
  }
  return counts;
}

// Every emitted roughing pass cuts at one level: a ring or cleanup path at its
// Z, a ramped one at the depth its ramp descends to (ADR-424).
function addRoughingLevels(levels: Set<number>, group: CncGroup): void {
  for (const pass of group.passes) {
    if (!cncPassCanEmit(pass)) continue;
    const depthMm = -representedCncCoordinateMm(passLevelZMm(pass));
    if (depthMm > 0) levels.add(depthMm);
  }
}

function passLevelZMm(pass: CncPass): number {
  if (pass.kind !== 'path3d') return pass.zMm;
  let lowestZMm = Number.POSITIVE_INFINITY;
  for (const point of pass.points) lowestZMm = Math.min(lowestZMm, point.z);
  return lowestZMm;
}

// Every other group records a ramp only where its passes ramp too (ADR-273
// Amendment 2). An operation that asks for a ramp, none of whose shape groups
// records one, enters its adaptive, drilled, inlay or helical passes without it.
function unrampedShapeLayerIds(job: Job, layers: ReadonlyArray<Layer>): ReadonlySet<string> {
  const shapeLayers = new Set<string>();
  const rampedLayers = new Set<string>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    if (group.cutType === 'relief-rough' || group.cutType === 'relief-finish') continue;
    shapeLayers.add(group.layerId);
    if (group.rampEntryDeg !== undefined) rampedLayers.add(group.layerId);
  }
  return new Set(
    layers
      .filter((layer) => requestsRamp(layer) && shapeLayers.has(layer.id))
      .filter((layer) => !rampedLayers.has(layer.id))
      .map((layer) => layer.id),
  );
}

// A V-carve's own entry request is disclosed apart (ADR-285 item 6).
function requestsRamp(layer: Layer): boolean {
  const settings = layer.cnc;
  return (
    settings !== undefined && settings.cutType !== 'v-carve' && settings.rampEntryDeg !== undefined
  );
}

function effectiveGroupSummary(
  group: Group,
  scene:
    | {
        readonly objects: ReadonlyArray<SceneObject>;
        readonly layers: ReadonlyArray<Layer>;
      }
    | undefined,
): string {
  const summary = group.kind === 'cnc' ? cncGroupSummary(group) : laserGroupSummary(group, scene);
  const object = scene?.objects.find((candidate) => candidate.id === group.sourceObjectId);
  return object === undefined ? summary : `${artworkOperationName(object)} — ${summary}`;
}

function cncGroupSummary(group: CncGroup): string {
  const tool = group.toolName ?? group.toolId ?? 'active bit';
  const coolant =
    group.coolant === undefined || group.coolant === 'off'
      ? 'coolant off'
      : `${group.coolant} coolant`;
  const actualMaxDepth = cncGroupMaximumDepth(group);
  const actualDepth = reportsGeometryDerivedDepth(group.cutType)
    ? `Actual max depth ${formatCoordinateText(actualMaxDepth.text)} mm · `
    : group.requestedDepthMm !== undefined &&
        requestedCncCoordinateText(group.requestedDepthMm) !== actualMaxDepth.text
      ? `Emitted max depth ${formatCoordinateText(actualMaxDepth.text)} mm (${formatRequestedNumber(group.requestedDepthMm)} requested) · `
      : '';
  return (
    actualDepth +
    (group.cuttingStage === undefined ? '' : `${cncCuttingStageLabel(group.cuttingStage)} · `) +
    `${tool} · ${group.passes.length} ${plural(group.passes.length, 'pass', 'passes')}` +
    ` · ${formatNumber(effectiveGcodeFeedMmPerMin(group.feedMmPerMin))} mm/min feed` +
    ` · ${formatNumber(effectiveGcodeFeedMmPerMin(group.plungeMmPerMin))} mm/min plunge` +
    ` · ${formatNumber(Math.max(0, Math.round(group.spindleRpm)))} RPM · ${coolant}` +
    nominalChiploadSummary(group)
  );
}

function nominalChiploadSummary(group: CncGroup): string {
  if (group.toolFluteCount === undefined) return '';
  const chipload = nominalChiploadMm(group.feedMmPerMin, group.spindleRpm, group.toolFluteCount);
  return chipload === null ? '' : ` · ${chipload.toFixed(4)} mm/tooth programmed nominal chipload`;
}

function laserGroupSummary(
  group: Exclude<Group, CncGroup>,
  scene:
    | {
        readonly objects: ReadonlyArray<SceneObject>;
        readonly layers: ReadonlyArray<Layer>;
      }
    | undefined,
): string {
  const kind = laserGroupKindLabel(group);
  const powerMode =
    group.kind !== 'raster' && group.powerMode !== undefined ? ` · ${group.powerMode} power` : '';
  const speed =
    group.requestedSpeed === undefined
      ? `${formatNumber(group.speed)} mm/min`
      : `${formatNumber(group.speed)} mm/min effective (${formatNumber(group.requestedSpeed)} requested)`;
  const baseLayer = scene?.layers.find((layer) => layer.id === group.layerId);
  const overrideFacts =
    group.operationSettings === undefined
      ? ''
      : scene === undefined
        ? ` · effective override: ${laserOperationDetail(group.operationSettings)}`
        : ` · requested ${baseLayer?.name ?? group.layerId}; effective artwork override: ${laserOperationDetail(group.operationSettings)}`;
  const contourEntry = contourEntrySummary(group);
  return (
    `${kind} · ${formatNumber(group.power)}% power` +
    ` · ${speed}` +
    ` · ${group.passes} ${plural(group.passes, 'pass', 'passes')}` +
    ` · air ${group.airAssist ? 'on' : 'off'}${powerMode}${contourEntry}${overrideFacts}`
  );
}

function laserGroupKindLabel(group: Exclude<Group, CncGroup>): string {
  if (group.kind === 'fill') return 'Fill';
  if (group.kind === 'raster') return 'Image';
  // ADR-494: the group that burns a Line operation's tab spans.
  return group.tabSpanPowerPercent === undefined
    ? 'Line'
    : tabSpanGroupLabel(group.tabSpanPowerPercent);
}

function reportsGeometryDerivedDepth(cutType: string): boolean {
  return cutType === 'v-carve' || cutType === 'relief-rough' || cutType === 'relief-finish';
}

function contourEntrySummary(group: Exclude<Group, CncGroup>): string {
  if (
    (group.kind === 'cut' || (group.kind === 'fill' && group.fillStyle === 'offset')) &&
    group.entryRunwayMm !== undefined
  ) {
    return ` · contour entry ${formatNumber(group.entryRunwayMm)} mm effective (laser off)`;
  }
  return '';
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatCoordinateText(text: string): string {
  return Number(text).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatRequestedNumber(value: number): string {
  const text = requestedCncCoordinateText(value);
  return text === String(value) ? text : formatNumber(Number(text));
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
