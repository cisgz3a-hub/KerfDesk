import type { OverrideValues, StatusReport, StreamingMode } from '../../../core/controllers/grbl';
import type { ControllerKind } from '../../../core/devices';
import type { JobOriginPlacement } from '../../../core/job';
import type { ControllerSettingsSnapshot } from '../../../core/preflight';
import {
  countSendableLines,
  fingerprintGcode,
  type GcodeFingerprint,
  type JobMachineKind,
} from '../../../core/recovery';
import {
  buildCncRecoveryEventManifest,
  type CncRecoveryEventManifest,
} from '../../../core/recovery/cnc';
import { machineKindOf, type OutputScope } from '../../../core/scene';
import type { PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import type { CncToolPlanEntry } from '../cnc-tool-plan';
import type { WorkCoordinateOffset } from '../origin-actions';
import type { WorkZZeroEvidence } from '../work-z-zero-evidence';

export const EXECUTION_ARTIFACT_SCHEMA_VERSION = 1;
export type RunId = string;
export type PreparedExecutionOutput = Extract<PreparedOutput, { readonly ok: true }>;

export type ArchivedControllerObservationV1 = {
  /** Diagnostic evidence only. No field in this object may be replayed to a controller. */
  readonly settings: ControllerSettingsSnapshot | null;
  readonly observedAtIso: string;
  readonly statusReport?: StatusReport | null;
  readonly wco?: WorkCoordinateOffset | null;
  readonly overrides?: OverrideValues | null;
  readonly accessories?: NonNullable<StatusReport['accessories']> | null;
  readonly workZZeroEvidence?: WorkZZeroEvidence | null;
  readonly activeControllerKind?: ControllerKind;
  readonly detectedControllerKind?: ControllerKind | null;
  readonly controllerSessionEpoch?: number;
};

export type ArchivedControllerObservationInput = Omit<
  ArchivedControllerObservationV1,
  'settings' | 'observedAtIso'
>;

export type ExecutionArtifactV1 = {
  readonly schemaVersion: typeof EXECUTION_ARTIFACT_SCHEMA_VERSION;
  readonly kind: 'exact-execution';
  readonly runId: RunId;
  readonly createdAtIso: string;
  readonly gcode: string;
  readonly fingerprint: GcodeFingerprint;
  readonly sendableLines: number;
  readonly machineKind: JobMachineKind;
  readonly controller: {
    readonly kind: ControllerKind;
    readonly streamingMode: StreamingMode;
    readonly rxBufferBytes: number;
  };
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  readonly executionSignature: string;
  readonly prepared: PreparedExecutionOutput;
  readonly canvasPlan: CanvasMotionPlan;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly cncRecoveryManifest?: CncRecoveryEventManifest | undefined;
  readonly archivedControllerObservation: ArchivedControllerObservationV1;
};

export type LegacyFingerprintOnlyArtifactV1 = {
  readonly schemaVersion: typeof EXECUTION_ARTIFACT_SCHEMA_VERSION;
  readonly kind: 'legacy-fingerprint-only';
  readonly runId: RunId;
  readonly createdAtIso: string;
  readonly migratedAtIso: string;
  readonly fingerprint: GcodeFingerprint;
  readonly sendableLines: number;
  readonly machineKind: JobMachineKind;
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
};

export type RecoveryArtifactV1 = ExecutionArtifactV1 | LegacyFingerprintOnlyArtifactV1;

export function createExecutionArtifact(args: {
  readonly runId: RunId;
  readonly gcode: string;
  readonly prepared: PreparedExecutionOutput;
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  readonly canvasPlan: CanvasMotionPlan;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerObservation?: ArchivedControllerObservationInput;
  readonly createdAtIso: string;
}): ExecutionArtifactV1 {
  const machineKind = machineKindOf(args.prepared.project.machine);
  const device = args.prepared.project.device;
  const cncRecoveryManifest =
    machineKind === 'cnc' ? buildCncRecoveryEventManifest(args.prepared.job) : undefined;
  return {
    schemaVersion: EXECUTION_ARTIFACT_SCHEMA_VERSION,
    kind: 'exact-execution',
    runId: args.runId,
    createdAtIso: args.createdAtIso,
    gcode: args.gcode,
    fingerprint: fingerprintGcode(args.gcode),
    sendableLines: countSendableLines(args.gcode),
    machineKind,
    controller: {
      kind:
        args.controllerObservation?.activeControllerKind ?? device.controllerKind ?? 'grbl-v1.1',
      streamingMode: device.streamingMode,
      rxBufferBytes: device.rxBufferBytes,
    },
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    executionSignature: args.canvasPlan.retentionKey,
    prepared: args.prepared,
    canvasPlan: args.canvasPlan,
    ...(args.cncToolPlan === undefined ? {} : { cncToolPlan: args.cncToolPlan }),
    ...(cncRecoveryManifest === undefined ? {} : { cncRecoveryManifest }),
    archivedControllerObservation: {
      settings: args.controllerSettings,
      observedAtIso: args.createdAtIso,
      ...args.controllerObservation,
    },
  };
}

export function createRunId(
  randomUuid: () => string = () => globalThis.crypto.randomUUID(),
): RunId {
  return `run-${randomUuid()}`;
}

export function isRunId(value: unknown): value is RunId {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

export function isExecutionArtifact(value: unknown): value is ExecutionArtifactV1 {
  if (!isRecord(value)) return false;
  if (!hasExecutionHeader(value) || !hasExecutionPayload(value)) return false;
  const gcode = value['gcode'];
  const expected = fingerprintGcode(gcode);
  if (!fingerprintsMatch(value['fingerprint'], expected)) return false;
  return value['sendableLines'] === countSendableLines(gcode);
}

export function isLegacyFingerprintArtifact(
  value: unknown,
): value is LegacyFingerprintOnlyArtifactV1 {
  if (!isRecord(value)) return false;
  return (
    value['schemaVersion'] === EXECUTION_ARTIFACT_SCHEMA_VERSION &&
    value['kind'] === 'legacy-fingerprint-only' &&
    isRunId(value['runId']) &&
    typeof value['createdAtIso'] === 'string' &&
    typeof value['migratedAtIso'] === 'string' &&
    isFingerprint(value['fingerprint']) &&
    isNonNegativeInteger(value['sendableLines']) &&
    (value['machineKind'] === 'laser' || value['machineKind'] === 'cnc')
  );
}

export function isRecoveryArtifact(value: unknown): value is RecoveryArtifactV1 {
  return isExecutionArtifact(value) || isLegacyFingerprintArtifact(value);
}

function fingerprintsMatch(value: unknown, expected: GcodeFingerprint): boolean {
  return (
    isFingerprint(value) &&
    value.fnv1a === expected.fnv1a &&
    value.chars === expected.chars &&
    value.lines === expected.lines
  );
}

function hasExecutionHeader(value: Record<string, unknown>): value is Record<string, unknown> & {
  readonly gcode: string;
  readonly sendableLines: number;
} {
  return (
    value['schemaVersion'] === EXECUTION_ARTIFACT_SCHEMA_VERSION &&
    value['kind'] === 'exact-execution' &&
    isRunId(value['runId']) &&
    typeof value['createdAtIso'] === 'string' &&
    typeof value['gcode'] === 'string' &&
    isNonNegativeInteger(value['sendableLines']) &&
    (value['machineKind'] === 'laser' || value['machineKind'] === 'cnc')
  );
}

function hasExecutionPayload(value: Record<string, unknown>): boolean {
  return (
    isRecord(value['prepared']) &&
    value['prepared']['ok'] === true &&
    isRecord(value['controller']) &&
    isRecord(value['canvasPlan']) &&
    isRecord(value['archivedControllerObservation']) &&
    typeof value['executionSignature'] === 'string'
  );
}

function isFingerprint(value: unknown): value is GcodeFingerprint {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeInteger(value['fnv1a']) &&
    isNonNegativeInteger(value['chars']) &&
    isNonNegativeInteger(value['lines']) &&
    value['lines'] >= 1
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
