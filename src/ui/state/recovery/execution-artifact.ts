import type { OverrideValues, StatusReport, StreamingMode } from '../../../core/controllers/grbl';
import type { ControllerKind } from '../../../core/devices';
import type { JobOriginPlacement } from '../../../core/job';
import type { Group, RasterGroup } from '../../../core/job/job';
import type { ControllerSettingsSnapshot } from '../../../core/preflight';
import { MAX_RASTER_WORKING_BYTES } from '../../../core/raster/raster-budget';
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
import {
  isExecutionProvenance,
  type ExecutionProvenance,
  type ExecutionProvenanceV2,
} from './execution-provenance';
import {
  assertExecutionArtifactSizeWithinBudget,
  estimateExecutionArtifactBytes,
} from './execution-artifact-size';

export { estimateExecutionArtifactBytes } from './execution-artifact-size';

export const LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION = 1;
export const EXECUTION_ARTIFACT_SCHEMA_VERSION = 2;
/** Keep the archive copy plus IndexedDB's structured clone within the same
 * bounded-memory envelope as raster compilation. Larger streamed jobs remain
 * executable, but deliberately run without recovery/archive capture. */
export const MAX_EXECUTION_ARTIFACT_RASTER_BYTES = MAX_RASTER_WORKING_BYTES / 2;
type ExecutionArtifactSchemaVersion =
  | typeof LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION
  | typeof EXECUTION_ARTIFACT_SCHEMA_VERSION;
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

export function createArchivedControllerObservation(args: {
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerObservation?: ArchivedControllerObservationInput;
  readonly observedAtIso: string;
}): ArchivedControllerObservationV1 {
  return {
    settings: args.controllerSettings,
    observedAtIso: args.observedAtIso,
    ...args.controllerObservation,
  };
}

export type ExecutionArtifactV1 = {
  readonly schemaVersion: ExecutionArtifactSchemaVersion;
  readonly kind: 'exact-execution';
  readonly runId: RunId;
  readonly createdAtIso: string;
  readonly gcode: string;
  readonly fingerprint: GcodeFingerprint;
  readonly sendableLines: number;
  /** Deterministic approximation of the full structured-clone payload size.
   * Includes embedded project data and binary raster buffers, not only G-code. */
  readonly estimatedArtifactBytes?: number;
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
  /** Ordered, deterministic resume transforms applied after emitting `prepared`.
   * Absent for ordinary starts and CNC recovery jobs. */
  readonly laserResumeChain?: ReadonlyArray<{ readonly fromLine: number }>;
  readonly canvasPlan: CanvasMotionPlan;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly cncRecoveryManifest?: CncRecoveryEventManifest | undefined;
  // Operator's machine-specific air-cut/scrap-test qualification record for a
  // supervised CNC recovery. The recovery policy only checks it is non-empty, so
  // archiving it verbatim gives the run an audit trail of exactly what was
  // attested (audit A1). Absent for ordinary starts.
  readonly recoveryQualification?: string;
  readonly archivedControllerObservation: ArchivedControllerObservationV1;
  /** Additive forensic record. Only schema-v1 artifacts created before
   * provenance capture may omit it; old recovery data remains replayable. */
  readonly provenance?: ExecutionProvenance;
};

export type CurrentExecutionArtifactV2 = ExecutionArtifactV1 & {
  readonly schemaVersion: typeof EXECUTION_ARTIFACT_SCHEMA_VERSION;
  readonly provenance: ExecutionProvenanceV2;
};

export type LegacyFingerprintOnlyArtifactV1 = {
  readonly schemaVersion: typeof LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION;
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

type CreateExecutionArtifactBase = {
  readonly runId: RunId;
  readonly gcode: string;
  readonly prepared: PreparedExecutionOutput;
  readonly laserResumeChain?: ReadonlyArray<{ readonly fromLine: number }>;
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  readonly canvasPlan: CanvasMotionPlan;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly recoveryQualification?: string;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerObservation?: ArchivedControllerObservationInput;
  readonly archivedControllerObservation?: ArchivedControllerObservationV1;
  readonly createdAtIso: string;
};

type CreateExecutionArtifactArgs = CreateExecutionArtifactBase &
  (
    | {
        /** Explicit opt-in used only to reproduce exact artifacts written before
         * provenance became mandatory. New execution capture must omit this and
         * supply current V2 provenance. */
        readonly artifactSchemaVersion: typeof LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION;
        readonly provenance?: ExecutionProvenance;
      }
    | {
        readonly artifactSchemaVersion?: typeof EXECUTION_ARTIFACT_SCHEMA_VERSION;
        readonly provenance: ExecutionProvenanceV2;
      }
  );

export function createExecutionArtifact(args: CreateExecutionArtifactArgs): ExecutionArtifactV1 {
  assertExecutionArtifactSizeWithinBudget(
    args,
    streamedRasterMaterializationBytes(args.prepared),
    true,
  );
  const prepared = preparedOutputForPersistence(args.prepared);
  const machineKind = machineKindOf(prepared.project.machine);
  const device = prepared.project.device;
  const cncRecoveryManifest =
    machineKind === 'cnc' ? buildCncRecoveryEventManifest(prepared.job) : undefined;
  const archivedControllerObservation = archivedObservationForArtifact(args);
  const artifact: ExecutionArtifactV1 = {
    schemaVersion: args.artifactSchemaVersion ?? EXECUTION_ARTIFACT_SCHEMA_VERSION,
    kind: 'exact-execution',
    runId: args.runId,
    createdAtIso: args.createdAtIso,
    gcode: args.gcode,
    fingerprint: fingerprintGcode(args.gcode),
    sendableLines: countSendableLines(args.gcode),
    machineKind,
    controller: {
      kind:
        archivedControllerObservation.activeControllerKind ?? device.controllerKind ?? 'grbl-v1.1',
      streamingMode: device.streamingMode,
      rxBufferBytes: device.rxBufferBytes,
    },
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    executionSignature: args.canvasPlan.retentionKey,
    prepared,
    ...(args.laserResumeChain === undefined ? {} : { laserResumeChain: args.laserResumeChain }),
    canvasPlan: args.canvasPlan,
    ...(args.cncToolPlan === undefined ? {} : { cncToolPlan: args.cncToolPlan }),
    ...(cncRecoveryManifest === undefined ? {} : { cncRecoveryManifest }),
    ...(args.recoveryQualification === undefined
      ? {}
      : { recoveryQualification: args.recoveryQualification }),
    archivedControllerObservation,
    ...(args.provenance === undefined ? {} : { provenance: args.provenance }),
  };
  assertExecutionArtifactSizeWithinBudget(artifact);
  return { ...artifact, estimatedArtifactBytes: estimateExecutionArtifactBytes(artifact) };
}

function archivedObservationForArtifact(args: {
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerObservation?: ArchivedControllerObservationInput;
  readonly archivedControllerObservation?: ArchivedControllerObservationV1;
  readonly createdAtIso: string;
}): ArchivedControllerObservationV1 {
  if (args.archivedControllerObservation !== undefined) {
    return args.archivedControllerObservation;
  }
  return createArchivedControllerObservation({
    controllerSettings: args.controllerSettings,
    observedAtIso: args.createdAtIso,
    ...(args.controllerObservation === undefined
      ? {}
      : { controllerObservation: args.controllerObservation }),
  });
}

/** IndexedDB structured clone cannot persist the function-valued row provider
 * used by large runtime rasters. Materialize only the artifact copy; the live
 * compiled job keeps streaming rows and therefore keeps its bounded-memory
 * execution behavior. */
function preparedOutputForPersistence(prepared: PreparedExecutionOutput): PreparedExecutionOutput {
  const rasterBytes = prepared.job.groups.reduce(
    (total, group) => total + executionArtifactRasterBytes(group),
    0,
  );
  if (!Number.isSafeInteger(rasterBytes) || rasterBytes > MAX_EXECUTION_ARTIFACT_RASTER_BYTES) {
    throw new Error('Raster dimensions are too large to archive safely.');
  }
  let changed = false;
  const groups = prepared.job.groups.map((group): Group => {
    if (group.kind !== 'raster' || group.rowProvider === undefined) return group;
    changed = true;
    return materializedRasterGroup(group);
  });
  return changed ? { ...prepared, job: { ...prepared.job, groups } } : prepared;
}

function executionArtifactRasterBytes(group: Group): number {
  if (group.kind !== 'raster') return 0;
  if (group.rowProvider === undefined) return group.sValues.byteLength;
  const valueCount = group.pixelWidth * group.pixelHeight;
  const byteLength = valueCount * Uint16Array.BYTES_PER_ELEMENT;
  return Number.isSafeInteger(valueCount) && valueCount >= 0 && Number.isSafeInteger(byteLength)
    ? byteLength
    : Number.POSITIVE_INFINITY;
}

function streamedRasterMaterializationBytes(prepared: PreparedExecutionOutput): number {
  return prepared.job.groups.reduce((total, group) => {
    return group.kind === 'raster' && group.rowProvider !== undefined
      ? total + executionArtifactRasterBytes(group)
      : total;
  }, 0);
}

function materializedRasterGroup(group: RasterGroup): RasterGroup {
  const { rowProvider, ...stored } = group;
  if (rowProvider === undefined) return group;
  const valueCount = group.pixelWidth * group.pixelHeight;
  const byteLength = valueCount * Uint16Array.BYTES_PER_ELEMENT;
  if (
    !Number.isSafeInteger(valueCount) ||
    valueCount < 0 ||
    !Number.isSafeInteger(byteLength) ||
    byteLength > MAX_EXECUTION_ARTIFACT_RASTER_BYTES
  ) {
    throw new Error('Raster dimensions are too large to archive safely.');
  }
  const sValues = new Uint16Array(valueCount);
  for (let y = 0; y < group.pixelHeight; y += 1) {
    const row = rowProvider(y);
    if (!(row instanceof Uint16Array) || row.length !== group.pixelWidth) {
      throw new Error(
        `Raster row provider returned ${row.length} values; expected ${group.pixelWidth}.`,
      );
    }
    sValues.set(row, y * group.pixelWidth);
  }
  return { ...stored, sValues };
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
  if (!hasValidLaserResumeChain(value)) return false;
  const gcode = value['gcode'];
  const expected = fingerprintGcode(gcode);
  if (!fingerprintsMatch(value['fingerprint'], expected)) return false;
  return value['sendableLines'] === countSendableLines(gcode);
}

/** Current trust boundary for staging, hydration, archive export, and external
 * decode. Legacy exact artifacts are retained only as untrusted historical
 * data and are never authorized for runtime execution. */
export function isCurrentExecutionArtifact(value: unknown): value is CurrentExecutionArtifactV2 {
  return (
    isExecutionArtifact(value) &&
    value.schemaVersion === EXECUTION_ARTIFACT_SCHEMA_VERSION &&
    value.provenance?.schemaVersion === 2 &&
    value.provenance.archivedControllerObservationSha256 !== undefined
  );
}

function hasValidLaserResumeChain(value: Record<string, unknown>): boolean {
  const chain = value['laserResumeChain'];
  if (chain === undefined) return true;
  if (value['machineKind'] !== 'laser' || !Array.isArray(chain)) return false;
  return chain.every(
    (step) =>
      isRecord(step) &&
      typeof step['fromLine'] === 'number' &&
      Number.isInteger(step['fromLine']) &&
      step['fromLine'] >= 1,
  );
}

export function isLegacyFingerprintArtifact(
  value: unknown,
): value is LegacyFingerprintOnlyArtifactV1 {
  if (!isRecord(value)) return false;
  return (
    value['schemaVersion'] === LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION &&
    value['kind'] === 'legacy-fingerprint-only' &&
    isRunId(value['runId']) &&
    typeof value['createdAtIso'] === 'string' &&
    typeof value['migratedAtIso'] === 'string' &&
    isFingerprint(value['fingerprint']) &&
    isNonNegativeInteger(value['sendableLines']) &&
    (value['machineKind'] === 'laser' || value['machineKind'] === 'cnc') &&
    isOutputScope(value['outputScope'])
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
    isExecutionArtifactSchemaVersion(value['schemaVersion']) &&
    value['kind'] === 'exact-execution' &&
    isRunId(value['runId']) &&
    typeof value['createdAtIso'] === 'string' &&
    typeof value['gcode'] === 'string' &&
    isNonNegativeInteger(value['sendableLines']) &&
    (value['estimatedArtifactBytes'] === undefined ||
      isNonNegativeInteger(value['estimatedArtifactBytes'])) &&
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
    isOutputScope(value['outputScope']) &&
    typeof value['executionSignature'] === 'string' &&
    hasValidProvenanceForArtifactSchema(value)
  );
}

function hasValidProvenanceForArtifactSchema(value: Record<string, unknown>): boolean {
  const provenance = value['provenance'];
  if (value['schemaVersion'] === EXECUTION_ARTIFACT_SCHEMA_VERSION) {
    return (
      isExecutionProvenance(provenance) &&
      provenance.schemaVersion === 2 &&
      provenance.archivedControllerObservationSha256 !== undefined
    );
  }
  return provenance === undefined || isExecutionProvenance(provenance);
}

function isExecutionArtifactSchemaVersion(value: unknown): value is ExecutionArtifactSchemaVersion {
  return (
    value === LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION ||
    value === EXECUTION_ARTIFACT_SCHEMA_VERSION
  );
}

function isOutputScope(value: unknown): value is OutputScope {
  return (
    isRecord(value) &&
    typeof value['cutSelectedGraphics'] === 'boolean' &&
    typeof value['useSelectionOrigin'] === 'boolean' &&
    Array.isArray(value['selectedObjectIds']) &&
    value['selectedObjectIds'].every((id) => typeof id === 'string')
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
