// buildJobReviewModel maps one successful Start preparation and its store
// snapshots into the Job Review display model (ADR-224). Live editable sections
// still read stores directly; compiled facts come from the prepared job.

import type { OverrideValues } from '../../../core/controllers/grbl';
import {
  analyzeFillHeatRisk,
  formatDuration,
  type Job,
  type ScanOffsetPoint,
} from '../../../core/job';
import {
  DEFAULT_OUTPUT_SCOPE,
  machineKindOf,
  type MachineKind,
  type OutputScope,
  type Project,
} from '../../../core/scene';
import type { CncToolPlanEntry } from '../../state/cnc-tool-plan';
import type { LaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { cncSetupAttestationPrompt } from '../cnc-setup-acknowledgement';
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
import { buildEffectiveOperationReview } from './job-review-effective-operations';
import { buildOutputQualityReviewFacts, type JobReviewFact } from './job-review-live-rows';
import { detectAirAssistCyclingWarnings } from './air-assist-cycling-warnings';
import { detectAirAssistStartWarnings } from './air-assist-start-warnings';
import { detectM7AirAssistWarnings } from './m7-air-assist-warnings';
import { detectManualAirAssistWarnings } from './manual-air-assist-warnings';
import { detectParkOutsideFrameWarningsFromMetrics } from './park-outside-frame-warnings';
import { detectRotaryRasterQualificationWarnings } from './rotary-raster-qualification-warnings';
import {
  detectStreamThroughputWarnings,
  type StreamThroughputInput,
} from './stream-throughput-warnings';

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
  readonly outputQualityFacts: ReadonlyArray<JobReviewFact>;
  readonly effectiveOperations: ReturnType<typeof buildEffectiveOperationReview>;
};

export type JobReviewStreamThroughput = Pick<StreamThroughputInput, 'window' | 'controllerKind'>;

type JobReviewModelArgs = {
  readonly project: Project;
  readonly prepared: PreparedCurrentStart;
  readonly laserModeStartSnapshot: LaserModeStartSnapshot;
  readonly overrides: OverrideValues | null;
  readonly outputScope?: OutputScope;
  /** Live streaming window for the connected controller (ADR-331); callers
   * without a live session omit it and get no throughput advisory. */
  readonly streamThroughput?: JobReviewStreamThroughput;
};

export function buildJobReviewModel(args: JobReviewModelArgs): JobReviewModel {
  if (args.prepared.laserSecondPassChain !== undefined) return buildSecondPassReviewModel(args);
  const machineKind = machineKindOf(args.project.machine);
  const outputScope = args.outputScope ?? DEFAULT_OUTPUT_SCOPE;
  return {
    machineKind,
    stats: buildStatTiles(
      args.prepared,
      machineKind,
      args.project.device.scanningOffsets,
      outputScope,
    ),
    // prepared.warnings already carries controller/readiness/WCS/override
    // warnings; the intent set (raster upsample, trace-as-vector, fill heat)
    // was previously only a transient toast, so it joins the review here.
    // The M7 check runs against the exact prepared program, not the settings.
    warnings: dedupe([
      ...args.prepared.warnings,
      ...detectM7AirAssistWarnings(
        args.prepared.gcode,
        args.laserModeStartSnapshot.controllerBuildInfo,
        buildInfoObservationIsCurrent(args.laserModeStartSnapshot),
      ),
      ...detectManualAirAssistWarnings(args.prepared.prepared.job, args.project.device),
      ...detectAirAssistStartWarnings(
        args.prepared.prepared.job,
        args.project.device,
        args.project.scene.layers,
      ),
      ...detectAirAssistCyclingWarnings(
        args.prepared.prepared.job,
        args.project.device,
        args.project.scene.layers,
      ),
      ...detectParkOutsideFrameWarningsFromMetrics(
        args.prepared.metrics.motionBounds,
        args.prepared.metrics.parkTarget,
      ),
      ...detectRotaryRasterQualificationWarnings(
        args.prepared.prepared.project,
        args.prepared.prepared.job,
      ),
      ...(args.streamThroughput === undefined
        ? []
        : detectStreamThroughputWarnings({
            ...args.streamThroughput,
            gcode: args.prepared.gcode,
            motionSeconds: commandedMotionSeconds(args.prepared.metrics.duration),
            transportSeconds: args.prepared.metrics.duration.breakdown.transportSeconds ?? 0,
          })),
    ]),
    resolvedOriginLabel: describeJobOrigin(args.prepared.jobOrigin),
    toolPlanLabels: toolPlanLabels(args.prepared.cncToolPlan),
    acknowledgement: buildAcknowledgement(args, machineKind),
    outputQualityFacts: buildOutputQualityReviewFacts(
      args.prepared.prepared.job,
      args.project.scene.layers,
      args.project.device.scanningOffsets,
    ),
    effectiveOperations: buildEffectiveOperationReview(
      args.prepared.prepared.job,
      args.project.scene,
    ),
  };
}

/** The archived semantic job explains how the source was made; it is not a
 * count or power summary of the selected emitted program. Keep these facts
 * about the exact derived bytes and the operator's frozen brush selection. */
function buildSecondPassReviewModel(args: JobReviewModelArgs): JobReviewModel {
  const prepared = args.prepared;
  const selection = prepared.laserSecondPassChain?.at(-1)?.selection;
  const powers = [
    ...new Set(
      selection?.strokes
        .filter((stroke) => stroke.mode === 'paint')
        .map((stroke) => formatCount(stroke.powerScale * 100)) ?? [],
    ),
  ];
  return {
    machineKind: 'laser',
    stats: [
      timeTile(prepared.metrics.duration, 'laser'),
      sizeTile(prepared.metrics.jobBounds, prepared.metrics.motionBounds),
      {
        label: 'Output scope',
        value: 'Painted areas only',
        detail: 'Engraving is limited to your painted areas.',
        emphasis: 'text',
      },
      {
        label: 'Painted power',
        value: `${powers.join(' / ')}% of original`,
        detail: `Saved grayscale is scaled per brush and capped at S${formatCount(args.project.device.maxPowerS)}.`,
        emphasis: 'text',
      },
      gcodeTile(prepared.gcode),
      originTile(prepared.jobOrigin),
    ],
    warnings: dedupe([
      ...prepared.warnings,
      ...detectM7AirAssistWarnings(
        prepared.gcode,
        args.laserModeStartSnapshot.controllerBuildInfo,
        buildInfoObservationIsCurrent(args.laserModeStartSnapshot),
      ),
      ...secondPassThroughputWarnings(args),
    ]),
    resolvedOriginLabel: describeJobOrigin(prepared.jobOrigin),
    toolPlanLabels: [],
    acknowledgement: buildAcknowledgement(args, 'laser'),
    outputQualityFacts: [
      {
        label: 'Saved motion',
        value: 'Original speed, direction, and runways retained.',
        tone: 'default',
      },
      {
        label: 'Saved passes',
        value: 'Saved repeated passes repeat inside the painted areas.',
        tone: 'default',
      },
      {
        label: 'Overlapping strokes',
        value: 'The latest paint or erase stroke wins.',
        tone: 'default',
      },
    ],
    effectiveOperations: [],
  };
}

function secondPassThroughputWarnings(args: JobReviewModelArgs): ReadonlyArray<string> {
  if (args.streamThroughput === undefined) return [];
  return detectStreamThroughputWarnings({
    ...args.streamThroughput,
    gcode: args.prepared.gcode,
    motionSeconds: commandedMotionSeconds(args.prepared.metrics.duration),
    transportSeconds: args.prepared.metrics.duration.breakdown.transportSeconds ?? 0,
  });
}

// Cut plus travel: the seconds the planner expects motion to be commanded,
// which is the denominator for line and byte rates. Fixed G4 dwells stream no
// motion, so they are excluded.
function commandedMotionSeconds(estimate: PreparedCurrentStart['metrics']['duration']): number {
  return estimate.breakdown.cutSeconds + estimate.breakdown.travelSeconds;
}

function buildInfoObservationIsCurrent(snapshot: LaserModeStartSnapshot): boolean {
  return (
    snapshot.buildInfoObservation !== null &&
    snapshot.buildInfoObservation.sessionEpoch === snapshot.controllerSessionEpoch
  );
}

function buildStatTiles(
  prepared: PreparedCurrentStart,
  machineKind: MachineKind,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
  outputScope: OutputScope,
): ReadonlyArray<JobReviewStatTile> {
  const job = prepared.prepared.job;
  return [
    timeTile(prepared.metrics.duration, machineKind),
    sizeTile(prepared.metrics.jobBounds, prepared.metrics.motionBounds),
    operationsTile(job, machineKind, prepared.cncToolPlan),
    ...fillRunwayTiles(job, scanningOffsets),
    gcodeTile(prepared.gcode),
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
  const coverage = analyzeFillHeatRisk(job, scanningOffsets);
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
function originTile(origin: PreparedCurrentStart['jobOrigin']): JobReviewStatTile {
  return {
    label: 'Origin',
    value: originTileValue(origin),
    detail: originTileDetail(origin),
    emphasis: 'text',
  };
}

function timeTile(
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

function sizeTile(
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
    readonly prepared: PreparedCurrentStart;
    readonly laserModeStartSnapshot: LaserModeStartSnapshot;
    readonly overrides: OverrideValues | null;
  },
  machineKind: MachineKind,
): JobReviewAcknowledgement {
  if (machineKind === 'cnc') {
    return { kind: 'cnc', prompt: cncSetupAttestationPrompt(args.overrides) };
  }
  return laserModeStartAcknowledgementRequired(
    args.project,
    args.laserModeStartSnapshot,
    args.prepared.gcode,
  )
    ? { kind: 'laser-unverified', prompt: LASER_MODE_UNVERIFIED_START_PROMPT }
    : { kind: 'laser-verified' };
}

function toolPlanLabels(plan: ReadonlyArray<CncToolPlanEntry> | undefined): ReadonlyArray<string> {
  return (plan ?? []).map((entry, index) => `${index + 1}. ${entry.name ?? 'Active bit'}`);
}

function dedupe(warnings: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(warnings)];
}
