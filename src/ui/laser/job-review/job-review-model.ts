import * as jig from './job-review-registration-jig';
import { jobReviewCncReachWarnings } from './job-review-cnc-reach';
import { compiledFocusTestWarnings } from './focus-test-warnings';
// Job Review uses one successful Start preparation (ADR-224). Editable sections read stores;
// compiled facts come from the prepared job.

import type { OverrideValues } from '../../../core/controllers/grbl';
import type { ConvertedLaserSuspicion } from '../../../core/preflight/converted-laser-profile';
import type { JobOriginPlacement } from '../../../core/job';
import {
  DEFAULT_OUTPUT_SCOPE,
  machineKindOf,
  type MachineKind,
  type OutputScope,
  type Project,
} from '../../../core/scene';
import type { LaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { cncSetupAttestationPrompt } from '../cnc-setup-acknowledgement';
import {
  LASER_MODE_UNVERIFIED_START_PROMPT,
  laserModeStartAcknowledgementRequired,
} from '../laser-mode-start-acknowledgement';
import type { prepareCurrentStartJob } from '../start-job-source';
import {
  describeJobOrigin,
  formatCount,
  toolPlanLabels,
  uniqueReviewWarnings,
} from './job-review-format';
import { buildEffectiveOperationReview } from './job-review-effective-operations';
import { buildReviewedOmissions, type JobReviewOmissions } from './job-review-omissions';
import { programFactsOf, type ProgramFacts } from './program-facts';
import { buildStatTiles, gcodeTile, originTile, sizeTile, timeTile } from './job-review-stat-tiles';
import { buildOutputQualityReviewFacts, type JobReviewFact } from './job-review-live-rows';
import { detectArchiveCapacityWarnings } from './archive-capacity-warnings';
import { detectAirAssistCyclingWarnings } from './air-assist-cycling-warnings';
import { detectAirAssistStartWarnings } from './air-assist-start-warnings';
import { detectAirAssistStandbyWarnings } from './air-assist-standby-warnings';
import { detectM7AirAssistWarnings } from './m7-air-assist-warnings';
import { detectConstantPowerFirmwareWarnings } from './constant-power-firmware-warnings';
import { detectManualAirAssistWarnings } from './manual-air-assist-warnings';
import { detectMinFeatureWarnings } from './min-feature-warnings';
import { oldProjectBurnReviewWarnings } from '../../state/old-project-burn-review';
import { burningWhiteReviewWarnings } from '../../state/saved-white-notice';
import { detectPresetCorrectionWarnings } from './preset-correction-warnings';
import { detectStaleCatalogBitWarnings } from './stale-catalog-bit-warnings';
import {
  detectRotaryRowStepWarnings,
  type RotaryAxisStepSettings,
} from './rotary-row-step-warnings';
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

export interface JobReviewModel extends JobReviewOmissions, jig.ReviewFacts {
  readonly machineKind: MachineKind;
  readonly stats: ReadonlyArray<JobReviewStatTile>;
  readonly warnings: ReadonlyArray<string>;
  readonly resolvedOriginLabel: string;
  /** Placement of the reviewed job; decides where an unset CNC park ends. */
  readonly startFrom?: JobOriginPlacement['startFrom'];
  readonly toolPlanLabels: ReadonlyArray<string>;
  readonly acknowledgement: JobReviewAcknowledgement;
  readonly outputQualityFacts: ReadonlyArray<JobReviewFact>;
  readonly effectiveOperations: ReturnType<typeof buildEffectiveOperationReview>;
  /** A CNC that KerfDesk 1.0.29 may have made from a laser: Start waits until
   * the operator says which it is (ADR-637 Amendment 8). Joined by the gate. */
  readonly convertedLaser?: ConvertedLaserSuspicion;
}

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
  /** The live controller's $101/$102/$103, null when it reported no settings;
   *  omitted without a live session (ADR-315 Amendment 1). Advisory only. */
  readonly rotaryAxisSteps?: RotaryAxisStepSettings | null;
};

export function buildJobReviewModel(args: JobReviewModelArgs): JobReviewModel {
  if (args.prepared.laserSecondPassChain !== undefined) return buildSecondPassReviewModel(args);
  const machineKind = machineKindOf(args.project.machine);
  const outputScope = args.outputScope ?? DEFAULT_OUTPUT_SCOPE;
  const program = programFactsOf(args.prepared);
  return {
    machineKind,
    ...jig.facts(args.project, args.prepared.prepared.job, outputScope),
    ...buildReviewedOmissions(args.prepared, outputScope),
    stats: buildStatTiles(
      args.prepared,
      machineKind,
      args.project.device.scanningOffsets,
      outputScope,
      program,
    ),
    // prepared.warnings already carries controller/readiness/WCS/override
    // warnings; the intent set (raster upsample, trace-as-vector, fill heat)
    // was previously only a transient toast, so it joins the review here.
    // The M7 check runs against the exact prepared program, not the settings.
    warnings: uniqueReviewWarnings([
      ...compiledFocusTestWarnings(args.prepared.prepared),
      ...args.prepared.warnings,
      ...detectM7AirAssistWarnings(
        args.prepared.gcode,
        args.laserModeStartSnapshot.controllerBuildInfo,
        buildInfoObservationIsCurrent(args.laserModeStartSnapshot),
        program.usesM7,
      ),
      ...detectConstantPowerFirmwareWarnings(args),
      ...detectManualAirAssistWarnings(args.prepared.prepared.job, args.project.device),
      ...detectPresetCorrectionWarnings(args.project.device),
      ...oldProjectBurnReviewWarnings(args.project),
      ...burningWhiteReviewWarnings(args.project),
      ...detectStaleCatalogBitWarnings(args.project, args.prepared.cncToolPlan),
      ...jobReviewCncReachWarnings(args.prepared),
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
      ...detectAirAssistStandbyWarnings(args.prepared.prepared.job, args.project.device),
      ...detectParkOutsideFrameWarningsFromMetrics(
        args.prepared.metrics.motionBounds,
        args.prepared.metrics.parkTarget,
      ),
      ...detectRotaryRowStepWarnings(
        args.prepared.prepared.project,
        args.prepared.prepared.job,
        args.rotaryAxisSteps,
      ),
      ...detectRotaryRasterQualificationWarnings(
        args.prepared.prepared.project,
        args.prepared.prepared.job,
      ),
      ...detectArchiveCapacityWarnings(
        args.prepared,
        machineKind === 'laser',
        program.archiveBytes,
      ),
      ...detectMinFeatureWarnings(args.prepared.prepared.project, args.prepared.jobOrigin),
      ...throughputWarnings(args, program),
    ]),
    resolvedOriginLabel: describeJobOrigin(args.prepared.jobOrigin),
    startFrom: args.prepared.jobOrigin?.startFrom ?? 'absolute',
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
    warnings: uniqueReviewWarnings([
      ...prepared.warnings,
      ...detectM7AirAssistWarnings(
        prepared.gcode,
        args.laserModeStartSnapshot.controllerBuildInfo,
        buildInfoObservationIsCurrent(args.laserModeStartSnapshot),
      ),
      ...detectArchiveCapacityWarnings(prepared),
      ...throughputWarnings(args),
    ]),
    resolvedOriginLabel: describeJobOrigin(prepared.jobOrigin),
    startFrom: prepared.jobOrigin?.startFrom ?? 'absolute',
    toolPlanLabels: [],
    acknowledgement: buildAcknowledgement(args, 'laser'),
    outputQualityFacts: [
      {
        label: 'Saved motion',
        value: 'Original speed, direction and runways. Rows are replayed only around the paint.',
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

function throughputWarnings(
  args: JobReviewModelArgs,
  program?: ProgramFacts,
): ReadonlyArray<string> {
  if (args.streamThroughput === undefined) return [];
  return detectStreamThroughputWarnings({
    ...args.streamThroughput,
    gcode: args.prepared.gcode,
    motionSeconds: commandedMotionSeconds(args.prepared.metrics.duration),
    transportSeconds: args.prepared.metrics.duration.breakdown.transportSeconds ?? 0,
    ...(program === undefined ? {} : { program }),
  });
}

// Cut plus travel: the seconds the planner expects motion to be commanded,
// which is the denominator for line and byte rates. Fixed G4 dwells stream no
// motion, so they are excluded.
function commandedMotionSeconds(estimate: PreparedCurrentStart['metrics']['duration']): number {
  return estimate.breakdown.cutSeconds + estimate.breakdown.travelSeconds;
}

function buildInfoObservationIsCurrent(snapshot: LaserModeStartSnapshot): boolean {
  return snapshot.buildInfoObservation?.sessionEpoch === snapshot.controllerSessionEpoch;
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
    args.prepared.prepared.project,
    args.laserModeStartSnapshot,
    args.prepared.gcode,
  )
    ? { kind: 'laser-unverified', prompt: LASER_MODE_UNVERIFIED_START_PROMPT }
    : { kind: 'laser-verified' };
}
