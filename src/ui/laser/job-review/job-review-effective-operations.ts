import type { Group, Job } from '../../../core/job';
import { cncGroupMaximumDepthMm } from '../../../core/job/job';

export type JobReviewEffectiveOperation = {
  readonly layerId: string;
  readonly summaries: ReadonlyArray<string>;
  readonly cncActualMaxDepthMm?: number;
};

/** Summarize the groups that actually reached the exact prepared Job. */
export function buildEffectiveOperationReview(
  job: Job,
): ReadonlyArray<JobReviewEffectiveOperation> {
  const summariesByLayer = new Map<string, string[]>();
  const vCarveDepthByLayer = new Map<string, number>();
  for (const group of job.groups) {
    const summary = effectiveGroupSummary(group);
    const summaries = summariesByLayer.get(group.layerId) ?? [];
    if (!summaries.includes(summary)) summaries.push(summary);
    summariesByLayer.set(group.layerId, summaries);
    if (group.kind === 'cnc' && group.cutType === 'v-carve') {
      vCarveDepthByLayer.set(
        group.layerId,
        Math.max(vCarveDepthByLayer.get(group.layerId) ?? 0, cncGroupMaximumDepthMm(group)),
      );
    }
  }
  return [...summariesByLayer].map(([layerId, summaries]) => {
    const cncActualMaxDepthMm = vCarveDepthByLayer.get(layerId);
    return cncActualMaxDepthMm === undefined
      ? { layerId, summaries }
      : { layerId, summaries, cncActualMaxDepthMm };
  });
}

function effectiveGroupSummary(group: Group): string {
  if (group.kind === 'cnc') {
    const tool = group.toolName ?? group.toolId ?? 'active bit';
    const coolant =
      group.coolant === undefined || group.coolant === 'off'
        ? 'coolant off'
        : `${group.coolant} coolant`;
    const actualDepth = reportsGeometryDerivedDepth(group.cutType)
      ? `Actual max depth ${formatNumber(cncGroupMaximumDepthMm(group))} mm Â· `
      : '';
    return (
      actualDepth +
      `${tool} · ${group.passes.length} ${plural(group.passes.length, 'pass', 'passes')}` +
      ` · ${formatNumber(group.feedMmPerMin)} mm/min feed` +
      ` · ${formatNumber(group.plungeMmPerMin)} mm/min plunge` +
      ` · ${formatNumber(group.spindleRpm)} RPM · ${coolant}`
    );
  }

  const kind = group.kind === 'cut' ? 'Line' : group.kind === 'fill' ? 'Fill' : 'Image';
  const powerMode =
    group.kind !== 'raster' && group.powerMode !== undefined ? ` · ${group.powerMode} power` : '';
  return (
    `${kind} · ${formatNumber(group.power)}% power` +
    ` · ${formatNumber(group.speed)} mm/min` +
    ` · ${group.passes} ${plural(group.passes, 'pass', 'passes')}` +
    ` · air ${group.airAssist ? 'on' : 'off'}${powerMode}`
  );
}

function reportsGeometryDerivedDepth(cutType: string): boolean {
  return cutType === 'v-carve' || cutType === 'relief-rough' || cutType === 'relief-finish';
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
