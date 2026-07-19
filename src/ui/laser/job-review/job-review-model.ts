// buildJobReviewModel — pure mapping from one successful Start preparation
// (plus the store snapshots it was prepared against) to the display model
// the Job Review dialog renders (ADR-224). The review gate rebuilds this
// after every re-prepare; live sections (layers table, placement controls,
// controller/machine facts) read the stores directly instead.

import type { OverrideValues } from '../../../core/controllers/grbl';
import {
  computeJobBounds,
  computeJobMotionBounds,
  estimateJobDuration,
  formatDuration,
  type Job,
} from '../../../core/job';
import type { DeviceProfile } from '../../../core/devices';
import { machineKindOf, type MachineKind, type Project } from '../../../core/scene';
import type { CncToolPlanEntry } from '../../state/cnc-tool-plan';
import type { LaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { cncSetupAttestationPrompt } from '../cnc-setup-acknowledgement';
import { detectJobIntentWarnings } from '../job-intent-warnings';
import {
  LASER_MODE_UNVERIFIED_START_PROMPT,
  laserModeStartAcknowledgementRequired,
} from '../laser-mode-start-acknowledgement';
import type { prepareCurrentStartJob } from '../start-job-source';
import {
  describeJobOrigin,
  formatBoundsRange,
  formatBoundsSize,
  formatCount,
  formatGcodeSize,
  originTileDetail,
  originTileValue,
} from './job-review-format';
import { detectM7AirAssistWarnings } from './m7-air-assist-warnings';
import { detectManualAirAssistWarnings } from './manual-air-assist-warnings';

export type PreparedCurrentStart = Extract<
  Awaited<ReturnType<typeof prepareCurrentStartJob>>,
  { readonly ok: true }
>;

export type JobReviewStatTile = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  // 'text' renders the value at body size (origin names, not big numbers).
  readonly emphasis?: 'text';
};

export type JobReviewAcknowledgement =
  | { readonly kind: 'laser-verified' }
  | { readonly kind: 'laser-unverified'; readonly prompt: string }
  | { readonly kind: 'cnc'; readonly prompt: string };

export type JobReviewModel = {
  readonly machineKind: MachineKind;
  readonly stats: ReadonlyArray<JobReviewStatTile>;
  readonly warnings: ReadonlyArray<string>;
  readonly resolvedOriginLabel: string;
  readonly toolPlanLabels: ReadonlyArray<string>;
  readonly acknowledgement: JobReviewAcknowledgement;
};

export function buildJobReviewModel(args: {
  readonly project: Project;
  readonly prepared: PreparedCurrentStart;
  readonly laserModeStartSnapshot: LaserModeStartSnapshot;
  readonly overrides: OverrideValues | null;
}): JobReviewModel {
  const machineKind = machineKindOf(args.project.machine);
  return {
    machineKind,
    stats: buildStatTiles(args.project, args.prepared, machineKind),
    // prepared.warnings already carries controller/readiness/WCS/override
    // warnings; the intent set (raster upsample, trace-as-vector, fill heat)
    // was previously only a transient toast, so it joins the review here.
    // The M7 check runs against the exact prepared program, not the settings.
    warnings: dedupe([
      ...args.prepared.warnings,
      ...detectJobIntentWarnings(args.project),
      ...detectM7AirAssistWarnings(args.prepared.gcode, args.project.device),
      ...detectManualAirAssistWarnings(args.prepared.prepared.job, args.project.device),
    ]),
    resolvedOriginLabel: describeJobOrigin(args.prepared.jobOrigin),
    toolPlanLabels: toolPlanLabels(args.prepared.cncToolPlan),
    acknowledgement: buildAcknowledgement(args, machineKind),
  };
}

function buildStatTiles(
  project: Project,
  prepared: PreparedCurrentStart,
  machineKind: MachineKind,
): ReadonlyArray<JobReviewStatTile> {
  const job = prepared.prepared.job;
  const device = project.device;
  return [
    timeTile(job, device),
    sizeTile(job, device),
    operationsTile(job, machineKind, prepared.cncToolPlan),
    gcodeTile(prepared.gcode),
    originTile(prepared.jobOrigin),
  ];
}

// Placement controls live on the machine rail (v2 dropped them from the
// review); this read-only tile keeps the one safety-relevant placement fact
// in front of the operator right up to Confirm.
function originTile(origin: PreparedCurrentStart['jobOrigin']): JobReviewStatTile {
  return {
    label: 'Origin',
    value: originTileValue(origin),
    detail: originTileDetail(origin),
    emphasis: 'text',
  };
}

function timeTile(job: Job, device: DeviceProfile): JobReviewStatTile {
  const estimate = estimateJobDuration(job, device);
  return {
    label: 'Estimated time',
    value: formatDuration(estimate.totalSeconds),
    detail: `Cut ${formatDuration(estimate.breakdown.cutSeconds)} · travel ${formatDuration(estimate.breakdown.travelSeconds)}`,
  };
}

function sizeTile(job: Job, device: DeviceProfile): JobReviewStatTile {
  const bounds = computeJobBounds(job, device);
  if (bounds === null) return { label: 'Job size', value: '—', detail: 'No cut motion' };
  const motionBounds = computeJobMotionBounds(job, device);
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
    detail: `${formatBoundsRange(bounds)}${motionSuffix}`,
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

function gcodeTile(gcode: string): JobReviewStatTile {
  const lineCount = gcode.length === 0 ? 0 : gcode.trimEnd().split('\n').length;
  return {
    label: 'G-code',
    value: `${formatCount(lineCount)} lines`,
    detail: formatGcodeSize(gcode.length),
  };
}

function buildAcknowledgement(
  args: {
    readonly project: Project;
    readonly laserModeStartSnapshot: LaserModeStartSnapshot;
    readonly overrides: OverrideValues | null;
  },
  machineKind: MachineKind,
): JobReviewAcknowledgement {
  if (machineKind === 'cnc') {
    return { kind: 'cnc', prompt: cncSetupAttestationPrompt(args.overrides) };
  }
  return laserModeStartAcknowledgementRequired(args.project, args.laserModeStartSnapshot)
    ? { kind: 'laser-unverified', prompt: LASER_MODE_UNVERIFIED_START_PROMPT }
    : { kind: 'laser-verified' };
}

function toolPlanLabels(plan: ReadonlyArray<CncToolPlanEntry> | undefined): ReadonlyArray<string> {
  return (plan ?? []).map((entry, index) => `${index + 1}. ${entry.name ?? 'Active bit'}`);
}

function dedupe(warnings: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(warnings)];
}
