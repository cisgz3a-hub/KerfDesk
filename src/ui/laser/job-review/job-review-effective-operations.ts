import type { Group, Job } from '../../../core/job';

export type JobReviewEffectiveOperation = {
  readonly layerId: string;
  readonly summaries: ReadonlyArray<string>;
};

/** Summarize the groups that actually reached the exact prepared Job. */
export function buildEffectiveOperationReview(
  job: Job,
): ReadonlyArray<JobReviewEffectiveOperation> {
  const summariesByLayer = new Map<string, string[]>();
  for (const group of job.groups) {
    const summary = effectiveGroupSummary(group);
    const summaries = summariesByLayer.get(group.layerId) ?? [];
    if (!summaries.includes(summary)) summaries.push(summary);
    summariesByLayer.set(group.layerId, summaries);
  }
  return [...summariesByLayer].map(([layerId, summaries]) => ({ layerId, summaries }));
}

function effectiveGroupSummary(group: Group): string {
  if (group.kind === 'cnc') {
    const tool = group.toolName ?? group.toolId ?? 'active bit';
    const coolant =
      group.coolant === undefined || group.coolant === 'off'
        ? 'coolant off'
        : `${group.coolant} coolant`;
    return (
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

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
