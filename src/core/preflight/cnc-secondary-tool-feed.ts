import type { Job } from '../job';
import type { PreflightIssue } from './preflight';

/**
 * Surface the exact shared layer values a secondary cutter will receive.
 * Secondary tool IDs choose geometry only; feed, plunge, RPM, and any
 * operation-applicable depth/pass are shared layer settings associated with
 * the current primary cutter. This does not assert their historical origin.
 */
export function findCncSecondaryToolFeedIssues(job: Job): ReadonlyArray<PreflightIssue> {
  const issues: PreflightIssue[] = [];
  const seen = new Set<string>();
  for (const group of job.groups) {
    if (
      group.kind !== 'cnc' ||
      group.toolId === undefined ||
      group.layerPrimaryToolId === undefined ||
      group.toolId === group.layerPrimaryToolId
    ) {
      continue;
    }
    const tool = group.toolName ?? group.toolId;
    const retainedValues = [
      `feed ${group.feedMmPerMin} mm/min`,
      `plunge ${group.plungeMmPerMin} mm/min`,
      `${group.spindleRpm} RPM`,
      ...(group.depthPerPassMm === undefined ? [] : [`${group.depthPerPassMm} mm/pass`]),
    ].join(', ');
    const key = `${group.layerId}\u0000${group.toolId}\u0000${group.layerPrimaryToolId}\u0000${retainedValues}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      code: 'cnc-secondary-tool-feed-retained',
      message:
        `Layer ${group.layerId}: secondary bit "${tool}" shares these layer values with ` +
        `primary tool ${group.layerPrimaryToolId}: ${retainedValues}. ` +
        'Verify them for the secondary bit before cutting.',
    });
  }
  return issues;
}
