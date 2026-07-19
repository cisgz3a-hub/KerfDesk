import {
  findOversizedLine,
  isSendableGcodeLine,
  type OverrideValues,
  type StatusReport,
} from '../../core/controllers/grbl';
import type { StatusQueryCapability } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import type { SimilarityTransform } from '../../core/registration';
import type { JobOriginPlacement } from '../../core/job';
import type {
  ControllerSettingsSnapshot,
  PreflightOptions,
  ReadinessSettingsCapability,
} from '../../core/preflight';
import { runControllerReadiness } from '../../core/preflight';
import { DEFAULT_OUTPUT_SCOPE, type OutputScope, type Project } from '../../core/scene';
import {
  emitPreparedGcode,
  prepareOutput,
  prepareOutputSnapshot,
  type PreparedOutput,
  type VariableTextRenderer,
} from '../../io/gcode';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import type { FrameVerification } from '../state/frame-verification';
import { cncToolPlan, type CncToolPlanEntry } from '../state/cnc-tool-plan';
import type { WorkZZeroEvidence } from '../state/work-z-zero-evidence';
import {
  DEFAULT_JOB_PLACEMENT,
  trustedMotionOffsetForPreflight,
  type JobPlacementSettings,
  type ResolvedJobPlacement,
} from '../job-placement';
import type { HomingState } from '../state/laser-store';
import { cncWorkZeroToolStartIssue } from './cnc-start-advisories';
import { ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage } from './start-machine-refusals';
import { requiredFrameIssueFromPrepared } from './required-frame-readiness';
import { canvasPlanRetentionKey, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  controllerReportsInches,
  initialMachinePositionOption,
  okPreparation,
  placementForResolvedOrigin,
  resolveStartPlacement,
  withControllerReportUnits,
} from './start-job-preparation';
import { collectStartWarnings } from './start-job-warnings';
import { demotedPolicyWarnings, partitionEmitPreflight } from './start-job-readiness-policy';
import { collectPrintCutFrameWarnings } from './print-cut-frame-warnings';

export { CNC_REQUIRES_GRBL_MESSAGE } from './start-job-readiness-policy';

export const CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE =
  'Custom origin is active, but its physical machine location is not known yet. Wait for an Idle/WCO status report or reset origin before continuing.';
export const STATUS_ALARM_START_MESSAGE =
  'Controller reports Alarm. Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe.';

export type StartJobPreparation =
  | {
      readonly ok: true;
      readonly gcode: string;
      readonly warnings: ReadonlyArray<string>;
      readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
      readonly canvasPlan: CanvasMotionPlan;
      /** Exact compiled/placed Job used for this G-code. Recovery may only
       * derive a smaller semantic Job from this already-gated source. */
      readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
      readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
      // The RESOLVED origin this compile used (undefined = Absolute). The
      // checkpoint stores it so resume reproduces identical bytes (R1).
      readonly jobOrigin?: JobOriginPlacement;
    }
  | {
      readonly ok: false;
      readonly messages: ReadonlyArray<string>;
    };

export type MachineStartSnapshot = {
  readonly statusReport: StatusReport | null;
  readonly alarmCode: number | null;
  readonly hasActiveStreamer: boolean;
  readonly motionOperationActive?: boolean;
  readonly controllerOperationActive?: boolean;
  readonly autofocusBusy?: boolean;
  readonly workOriginActive?: boolean;
  readonly workZZeroEvidence?: WorkZZeroEvidence | null;
  readonly workZReferenceEpoch?: number;
  readonly controllerSessionEpoch?: number;
  readonly wcoCache?: WorkCoordinateOffset | null;
  // Active WCS (G54-G59) tracked from console commands and fresh modal
  // readback. Fresh Frame owns selection of emitted G54 before preparing the
  // exact artifact and durably discloses a known G55-G59 change in Job Review;
  // save and replay paths may still surface the direct mismatch advisory (C6).
  readonly activeWcs?: ActiveWorkCoordinateSystem | null;
  // Last live GRBL Ov: field, cached across intermittent status frames.
  // A known non-default value changes physical feed/RPM independently of the
  // prepared G-code, so Job Review surfaces it as an operator warning.
  readonly ovCache?: OverrideValues | null;
  // Last live GRBL A: observation. This is controller-commanded state, not
  // physical spindle/coolant sensor proof. Known active accessories warn in
  // Job Review; null/undefined remains unknown rather than invented as off.
  readonly accessoryCache?: NonNullable<StatusReport['accessories']> | null;
  // Transitional verified-bounds proof retained for recovery/compatibility;
  // ordinary fresh Start uses the exact completion-issued FramedRunPermit.
  readonly frameVerification?: FrameVerification | null;
  // ADR-094 — how the connected firmware exposes settings. Non-GRBL values
  // relax the $30/$32 readiness proof into an explicit unverified warning.
  readonly settingsCapability?: ReadinessSettingsCapability;
  // Connected-driver CNC dialect support. False produces a Job Review warning;
  // it does not refuse Frame or Start (ADR-228).
  readonly cncJobsSupported?: boolean;
  readonly activeControllerKind?: ControllerKind;
  readonly detectedControllerKind?: ControllerKind | null;
  // Camera placement observations used for warning/canvas context. These
  // optional fields keep non-camera callers backward-compatible.
  readonly cameraPlacementActive?: boolean;
  readonly cameraConfirmedPositionEpoch?: number | null;
  readonly cameraPlacementGeometryIssue?: string | null;
  readonly homingState?: HomingState;
  readonly trustedPositionEpoch?: number;
  readonly statusQuery?: StatusQueryCapability;
  readonly reportInches?: boolean;
};

export function prepareStartJob(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  // Resume only: the RESOLVED origin the original run compiled with. When set,
  // the compile reuses it (so a 'current-position' job reproduces the frozen
  // head XY and its checkpoint fingerprint) while the live machine is still
  // re-validated through the origin's mode (R1).
  resolvedJobOrigin?: JobOriginPlacement,
  allowRotaryRaster?: boolean,
  requireFrame = true,
): StartJobPreparation {
  const effectivePlacement = placementForResolvedOrigin(jobPlacement, resolvedJobOrigin);
  const gateIssues = findMachineStartIssues(machine);
  if (gateIssues.length > 0) return { ok: false, messages: gateIssues };

  const machineWithReportUnits = withControllerReportUnits(machine, controllerSettings);
  const placement = resolveStartPlacement(jobPlacement, machineWithReportUnits, resolvedJobOrigin);
  if (!placement.ok) return { ok: false, messages: placement.messages };
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);
  const inspected = inspectPreparedStart(
    prepareOutput(project, {
      ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
      outputScope,
    }),
    machine,
  );
  if (!inspected.ok) return inspected;
  return finalizeStartPreparation({
    project,
    controllerSettings,
    machine,
    machineWithReportUnits,
    outputScope,
    allowRotaryRaster: allowRotaryRaster === true,
    requireFrame,
    placement,
    motionOffset,
    inspected,
    canvasPlanKey: canvasPlanRetentionKey(project, outputScope, effectivePlacement),
    printCutRegistrationActive: false,
  });
}

export async function prepareStartJobSnapshot(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  machine: MachineStartSnapshot,
  jobPlacement: JobPlacementSettings,
  outputScope: OutputScope,
  allowRotaryRaster: boolean,
  options: {
    readonly clock: () => Date;
    readonly renderVariableText: VariableTextRenderer;
    readonly registration?: SimilarityTransform | null;
    readonly resolvedJobOrigin?: JobOriginPlacement;
    /** Frame preparation compiles the exact candidate before a permit exists. */
    readonly requireFrame?: boolean;
  },
): Promise<StartJobPreparation> {
  const effectivePlacement = placementForResolvedOrigin(jobPlacement, options.resolvedJobOrigin);
  const gateIssues = findMachineStartIssues(machine);
  if (gateIssues.length > 0) return { ok: false, messages: gateIssues };

  const machineWithReportUnits = withControllerReportUnits(machine, controllerSettings);
  const placement = resolveStartPlacement(
    jobPlacement,
    machineWithReportUnits,
    options.resolvedJobOrigin,
  );
  if (!placement.ok) return { ok: false, messages: placement.messages };
  const motionOffset = trustedMotionOffsetForPreflight(project.device, placement);

  const inspected = inspectPreparedStart(
    await prepareOutputSnapshot(project, {
      clock: options.clock,
      renderVariableText: options.renderVariableText,
      ...registrationOption(options.registration),
      ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
      outputScope,
    }),
    machine,
  );
  if (!inspected.ok) return inspected;
  return finalizeStartPreparation({
    project,
    controllerSettings,
    machine,
    machineWithReportUnits,
    outputScope,
    allowRotaryRaster,
    requireFrame: options.requireFrame !== false,
    placement,
    motionOffset,
    inspected,
    canvasPlanKey: canvasPlanRetentionKey(
      project,
      outputScope,
      effectivePlacement,
      options.registration,
    ),
    printCutRegistrationActive: options.registration !== undefined,
  });
}

type SuccessfulPreparedStartInspection = Extract<PreparedStartInspection, { readonly ok: true }>;

type FinalizeStartPreparationOptions = {
  readonly project: Project;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly machine: MachineStartSnapshot;
  readonly machineWithReportUnits: MachineStartSnapshot;
  readonly outputScope: OutputScope;
  readonly allowRotaryRaster: boolean;
  readonly requireFrame: boolean;
  readonly placement: Extract<ResolvedJobPlacement, { readonly ok: true }>;
  readonly motionOffset: PreflightOptions['motionOffset'];
  readonly inspected: SuccessfulPreparedStartInspection;
  readonly canvasPlanKey: string;
  readonly printCutRegistrationActive: boolean;
};

function finalizeStartPreparation({
  project,
  controllerSettings,
  machine,
  machineWithReportUnits,
  outputScope,
  allowRotaryRaster,
  requireFrame,
  placement,
  motionOffset,
  inspected,
  canvasPlanKey,
  printCutRegistrationActive,
}: FinalizeStartPreparationOptions): StartJobPreparation {
  const { prepared, toolPlan, advisoryWarnings } = inspected;
  const { gcode, preflight } = emitPreparedGcode(prepared, {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    outputScope,
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
    ...initialMachinePositionOption(machineWithReportUnits),
    allowRotaryRaster,
  });
  const emitSplit = partitionEmitPreflight(preflight);
  if (emitSplit.blocking.length > 0) {
    return { ok: false, messages: emitSplit.blocking };
  }
  const programIssue = preparedProgramIntegrityIssue(
    gcode,
    project.device.rxBufferBytes,
    preflight,
  );
  if (programIssue !== null) return { ok: false, messages: programIssue };
  if (requireFrame) {
    const verifiedFrameIssue = requiredFrameIssueFromPrepared({ prepared, machine });
    if (verifiedFrameIssue !== null) return { ok: false, messages: [verifiedFrameIssue] };
  }

  const controller = runControllerReadiness(project, controllerSettings, readinessMode(machine));
  const warnings = collectStartWarnings(
    project,
    controllerSettings,
    [
      ...demotedPolicyWarnings(project, machine),
      ...advisoryWarnings,
      ...emitSplit.warnings,
      ...collectPrintCutFrameWarnings(project, printCutRegistrationActive, placement.jobOrigin),
      // Frame-first: readiness errors ($30/$32 state) inform, never block.
      ...controller.errors.map((issue) => issue.message),
      ...controller.warnings.map((issue) => issue.message),
    ],
    machine.ovCache,
    machine.activeWcs,
  );
  return okPreparation(
    gcode,
    warnings,
    placement.jobOrigin,
    toolPlan,
    prepared,
    machine,
    motionOffset,
    controllerReportsInches(controllerSettings),
    canvasPlanKey,
  );
}

function nonExecutableProgramMessages(preflight: {
  readonly issues: ReadonlyArray<{ readonly message: string }>;
}): ReadonlyArray<string> {
  const messages = preflight.issues.map((issue) => issue.message);
  return messages.length > 0
    ? messages
    : ['The prepared job contains no executable controller commands. Nothing was framed or sent.'];
}

function preparedProgramIntegrityIssue(
  gcode: string,
  rxBufferBytes: number,
  preflight: { readonly issues: ReadonlyArray<{ readonly message: string }> },
): ReadonlyArray<string> | null {
  if (!gcode.split('\n').some(isSendableGcodeLine)) {
    return nonExecutableProgramMessages(preflight);
  }
  const oversized = findOversizedLine(gcode, rxBufferBytes);
  if (oversized === null) return null;
  return [
    `G-code line ${oversized.lineNumber} is ${oversized.bytes} bytes — longer than the ` +
      `controller's ${oversized.limit}-byte RX buffer; it can never be sent. Job not framed or started.`,
  ];
}

function registrationOption(registration: SimilarityTransform | null | undefined): {
  readonly registration?: SimilarityTransform | null;
} {
  return registration === undefined ? {} : { registration };
}

function readinessMode(machine: MachineStartSnapshot): ReadinessSettingsCapability {
  return machine.settingsCapability ?? 'grbl-dollar';
}

type PreparedStartInspection =
  | {
      readonly ok: true;
      readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
      readonly toolPlan: ReadonlyArray<CncToolPlanEntry>;
      // Frame-first: placement-bounds and tool/Work-Z findings inform the Job
      // Review instead of refusing the Start the Frame already proved out.
      readonly advisoryWarnings: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

function inspectPreparedStart(
  prepared: PreparedOutput,
  machine: MachineStartSnapshot,
): PreparedStartInspection {
  if (!prepared.ok) {
    return { ok: false, messages: prepared.preflight.issues.map((issue) => issue.message) };
  }
  const advisoryWarnings: string[] = [];
  const toolPlan = cncToolPlan(prepared.job);
  const toolIssue = cncWorkZeroToolStartIssue(
    prepared.project,
    machine.workZZeroEvidence,
    toolPlan[0],
  );
  if (toolIssue !== null) advisoryWarnings.push(toolIssue);
  return { ok: true, prepared, toolPlan, advisoryWarnings };
}

function findMachineStartIssues(machine: MachineStartSnapshot): ReadonlyArray<string> {
  const issues: string[] = [];
  if (machine.hasActiveStreamer) {
    issues.push('A job is already active. Request ABORT or finish it before starting another.');
  }
  if (machine.motionOperationActive === true) {
    issues.push('A jog or frame operation is active. Wait for it to finish before starting.');
  }
  if (machine.controllerOperationActive === true) {
    issues.push('A controller operation is active. Wait for it to finish before starting.');
  }
  if (machine.autofocusBusy === true) {
    issues.push('Auto-focus is running. Wait for it to finish before starting a job.');
  }
  if (machine.alarmCode !== null) {
    issues.push(ALARM_ACTIVE_START_MESSAGE);
  }
  if (machine.statusReport === null) {
    issues.push(
      'Controller status is not known yet. Wait for an Idle status report before starting.',
    );
  } else if (machine.statusReport.state === 'Alarm' && machine.alarmCode === null) {
    issues.push(STATUS_ALARM_START_MESSAGE);
  } else if (machine.statusReport.state !== 'Idle') {
    issues.push(machineNotIdleStartMessage(machine.statusReport.state));
  }
  return issues;
}
