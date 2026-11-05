// Job Review's stat tiles, built from one successful Start preparation (ADR-224).

import { formatDuration, type Job, type ScanOffsetPoint } from '../../../core/job';
import type { MachineKind, OutputScope } from '../../../core/scene';
import type { CncToolPlanEntry } from '../../state/cnc-tool-plan';
import { memoizedFillHeatRisk } from './fill-heat-risk-memo';
import {
  formatBoundsRange,
  formatBoundsSize,
  formatCount,
  formatGcodeSize,
  formatTrimmedLineCount,
  originTileDetail,
  originTileValue,
} from './job-review-format';
import type { JobReviewStatTile, PreparedCurrentStart } from './job-review-model';
import type { ProgramFacts } from './program-facts';

export function buildStatTiles(
  prepared: PreparedCurrentStart,
  machineKind: MachineKind,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
  outputScope: OutputScope,
  program: ProgramFacts,
): ReadonlyArray<JobReviewStatTile> {
  const job = prepared.prepared.job;
  return [
    timeTile(prepared.metrics.duration, machineKind),
    sizeTile(prepared.metrics.jobBounds, prepared.metrics.motionBounds),
    operationsTile(job, machineKind, prepared.cncToolPlan),
    ...fillRunwayTiles(job, scanningOffsets),
    gcodeTile(prepared.gcode, program.trimmedLineCount),
    originTile(prepared.jobOrigin),
    outputScopeTile(outputScope),
  ];
}

function outputScopeTile(outputScope: OutputScope): JobReviewStatTile {
  if (!outputScope.cutSelectedGraphics) {
    return {
      label: 'Output scope',
      value: 'Entire job',
      detail: 'All visible, enabled artwork is included',
      emphasis: 'text',
    };
  }
  const selectedCount = new Set(outputScope.selectedObjectIds).size;
  return {
    label: 'Output scope',
    value: 'Selected artwork only',
    detail: `${formatCount(selectedCount)} selected object${selectedCount === 1 ? '' : 's'} included`,
    emphasis: 'text',
  };
}

function fillRunwayTiles(
  job: Job,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): ReadonlyArray<JobReviewStatTile> {
  const coverage = memoizedFillHeatRisk(job, scanningOffsets);
  if (coverage.fillSweepCount === 0) return [];
  const requested = coverage.fillRequestedRunwayValuesMm.join(' / ');
  return [
    {
      label: 'Fill runway',
      value: `${formatCount(coverage.fillFullRunwaySweepCount)} / ${formatCount(coverage.fillSweepCount)} full`,
      detail:
        `Effective target ${requested} mm · ` +
        `${formatCount(coverage.fillPartialRunwaySweepCount)} partial · ` +
        `${formatCount(coverage.fillNoRunwaySweepCount)} skipped · ` +
        `${formatCount(coverage.fillDisabledRunwaySweepCount)} disabled`,
    },
  ];
}

// Placement controls live on the machine rail (v2 dropped them from the
// review); this read-only tile keeps the one safety-relevant placement fact
// in front of the operator right up to Confirm.
export function originTile(origin: PreparedCurrentStart['jobOrigin']): JobReviewStatTile {
  return {
    label: 'Origin',
    value: originTileValue(origin),
    detail: originTileDetail(origin),
    emphasis: 'text',
  };
}

export function timeTile(
  estimate: PreparedCurrentStart['metrics']['duration'],
  machineKind: MachineKind,
): JobReviewStatTile {
  if (estimate.unavailableReason !== undefined)
    return {
      label: 'Estimated time',
      value: 'Unavailable',
      detail: estimate.unavailableReason,
    };
  const cutLabel = machineKind === 'cnc' ? 'Cut + plunge' : 'Cut';
  const dwellLabel = machineKind === 'cnc' ? 'spindle dwell' : 'dwell';
  const details = [
    `${cutLabel} ${formatDuration(estimate.breakdown.cutSeconds)}`,
    `travel ${formatDuration(estimate.breakdown.travelSeconds)}`,
  ];
  if ((estimate.breakdown.dwellSeconds ?? 0) > 0)
    details.push(`${dwellLabel} ${formatDuration(estimate.breakdown.dwellSeconds ?? 0)}`);
  if ((estimate.breakdown.transportSeconds ?? 0) >= 0.5)
    details.push(`streaming ${formatDuration(estimate.breakdown.transportSeconds ?? 0)}`);
  if ((estimate.manualPauseCount ?? 0) > 0) details.push('plus manual tool-change time');
  return {
    label: 'Estimated time',
    value: formatDuration(estimate.totalSeconds),
    detail: details.join(' · '),
  };
}

export function sizeTile(
  bounds: PreparedCurrentStart['metrics']['jobBounds'],
  motionBounds: PreparedCurrentStart['metrics']['motionBounds'],
): JobReviewStatTile {
  if (bounds === null) return { label: 'Job size', value: '—', detail: 'No cut motion' };
  const motionDiffers =
    motionBounds !== null &&
    (motionBounds.minX !== bounds.minX ||
      motionBounds.minY !== bounds.minY ||
      motionBounds.maxX !== bounds.maxX ||
      motionBounds.maxY !== bounds.maxY);
  const motionSuffix = motionDiffers ? ` · motion ${formatBoundsSize(motionBounds)}` : '';
  return {
    label: 'Job size',
    value: formatBoundsSize(bounds),
    // The range is the G-code's own X/Y, which beside "Machine space" and the
    // bed positions of out-of-bed lines read as one frame (UX audit U4-P3-7).
    detail: `G-code ${formatBoundsRange(bounds)}${motionSuffix}`,
  };
}

function operationsTile(
  job: Job,
  machineKind: MachineKind,
  toolPlan: ReadonlyArray<CncToolPlanEntry> | undefined,
): JobReviewStatTile {
  if (machineKind === 'cnc' && toolPlan !== undefined && toolPlan.length > 0) {
    const changes = toolPlan.length - 1;
    return {
      label: 'Cutters',
      value: `${formatCount(toolPlan.length)} bit${toolPlan.length === 1 ? '' : 's'}`,
      detail: `${formatCount(changes)} tool change${changes === 1 ? '' : 's'}`,
    };
  }
  const totalPasses = job.groups.reduce(
    (sum, group) => sum + (group.kind === 'cnc' ? group.passes.length : group.passes),
    0,
  );
  return {
    label: 'Operations',
    value: `${formatCount(job.groups.length)} operation${job.groups.length === 1 ? '' : 's'}`,
    detail: `${formatCount(totalPasses)} pass${totalPasses === 1 ? '' : 'es'} total`,
  };
}

export function gcodeTile(
  gcode: string,
  trimmedLineCount: number = formatTrimmedLineCount(gcode),
): JobReviewStatTile {
  return {
    label: 'G-code',
    value: `${formatCount(trimmedLineCount)} lines`,
    detail: formatGcodeSize(gcode.length),
  };
}
