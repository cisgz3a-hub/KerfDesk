import type { CncGroup, Group, Job } from '../../../core/job';
import { cncGroupMaximumDepth } from '../../../core/cnc/output-representation';
import {
  type CncCoordinateRepresentation,
  requestedCncCoordinateText,
} from '../../../core/cnc/coordinate-representation';
import { artworkOperationName, type Layer, type SceneObject } from '../../../core/scene';
import { laserOperationDetail } from './job-review-detail-facts';

export type JobReviewEffectiveOperation = {
  readonly layerId: string;
  readonly summaries: ReadonlyArray<string>;
  readonly cncActualMaxDepthMm?: number;
};

/** Summarize the groups that actually reached the exact prepared Job. */
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
  return [...summariesByLayer].map(([layerId, summaries]) => {
    const cncActualMaxDepth = vCarveDepthByLayer.get(layerId);
    return cncActualMaxDepth === undefined
      ? { layerId, summaries }
      : { layerId, summaries, cncActualMaxDepthMm: cncActualMaxDepth.value };
  });
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
    `${tool} · ${group.passes.length} ${plural(group.passes.length, 'pass', 'passes')}` +
    ` · ${formatNumber(group.feedMmPerMin)} mm/min feed` +
    ` · ${formatNumber(group.plungeMmPerMin)} mm/min plunge` +
    ` · ${formatNumber(group.spindleRpm)} RPM · ${coolant}`
  );
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
  const kind = group.kind === 'cut' ? 'Line' : group.kind === 'fill' ? 'Fill' : 'Image';
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
