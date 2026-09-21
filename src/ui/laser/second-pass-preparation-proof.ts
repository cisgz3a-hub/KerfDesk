import type { LaserSecondPassSelection } from '../../core/laser-second-pass';
import { fingerprintsEqual, type GcodeFingerprint } from '../../core/recovery';
import type { MotionManifest, MotionPoint } from '../../core/job/motion-manifest';
import type { JobDurationEstimate } from '../../core/job';
import type { PreparedStartProgram } from '../state/framed-run';
import type { ExecutionArtifactV1 } from '../state/recovery';
import { selectionKey } from '../state/recovery/laser-second-pass-lineage';
import { serializeCanonicalDeviceProfile } from '../../io/machine-profile/machine-profile-io';

export type LaserSecondPassSourceSnapshot = {
  readonly source: ExecutionArtifactV1;
  readonly sourceGcode: string;
  readonly sourcePrepared: ExecutionArtifactV1['prepared'];
  readonly sourceProject: ExecutionArtifactV1['prepared']['project'];
  readonly sourceJob: ExecutionArtifactV1['prepared']['job'];
  readonly sourceRunId: string;
  readonly sourceFingerprint: GcodeFingerprint;
  readonly metadata: string;
};

type PreparationProof = {
  readonly source: LaserSecondPassSourceSnapshot;
  readonly selection: string;
  readonly prepared: PreparedStartProgram;
  readonly requalify?: RequalifyLaserSecondPassPreparation;
};

export type LaserSecondPassFrameGeometry = {
  readonly manifest: MotionManifest;
  readonly duration: JobDurationEstimate;
};
export type RequalifyLaserSecondPassPreparation = (
  initialPosition: MotionPoint,
) => Promise<LaserSecondPassFrameGeometry>;

const verifiedPreparations = new WeakMap<PreparedStartProgram, PreparationProof>();

/** Internal worker-result handoff. Call only after worker source integrity +
 * canonical binding checks and successful deterministic region compilation.
 * Keeping that work in the worker prevents a second long compile at Frame. */
export function registerVerifiedLaserSecondPassPreparation(
  source: ExecutionArtifactV1,
  prepared: PreparedStartProgram,
  selection: LaserSecondPassSelection,
  requalify?: RequalifyLaserSecondPassPreparation,
): void {
  verifiedPreparations.set(prepared, {
    source: captureLaserSecondPassSource(source),
    selection: selectionKey(selection),
    prepared: captureVerifiedPreparation(prepared),
    ...(requalify === undefined ? {} : { requalify }),
  });
}

/** Capture small execution metadata by value and retain identities for the
 * large immutable prepared graph. No raster pixels or toolpaths are serialized. */
export function captureLaserSecondPassSource(
  source: ExecutionArtifactV1,
): LaserSecondPassSourceSnapshot {
  return {
    source,
    sourceGcode: source.gcode,
    sourcePrepared: source.prepared,
    sourceProject: source.prepared.project,
    sourceJob: source.prepared.job,
    sourceRunId: source.runId,
    sourceFingerprint: { ...source.fingerprint },
    metadata: sourceMetadataKey(source),
  };
}

export async function requalifyVerifiedLaserSecondPassPreparation(
  source: ExecutionArtifactV1,
  prepared: PreparedStartProgram,
  selection: LaserSecondPassSelection,
  initialPosition: MotionPoint,
): Promise<LaserSecondPassFrameGeometry | null> {
  if (verifiedLaserSecondPassPreparation(source, prepared, selection) === null) return null;
  return verifiedPreparations.get(prepared)?.requalify?.(initialPosition) ?? null;
}

export function verifiedLaserSecondPassPreparation(
  source: ExecutionArtifactV1,
  prepared: PreparedStartProgram,
  selection: LaserSecondPassSelection,
): PreparedStartProgram | null {
  const proof = verifiedPreparations.get(prepared);
  if (proof === undefined || !laserSecondPassSourceMatches(proof.source, source)) return null;
  return proof.selection === selectionKey(selection) && proof.prepared.gcode === prepared.gcode
    ? proof.prepared
    : null;
}

export function laserSecondPassSourceMatches(
  proof: LaserSecondPassSourceSnapshot,
  source: ExecutionArtifactV1,
): boolean {
  return (
    proof.source === source &&
    proof.sourceGcode === source.gcode &&
    proof.sourcePrepared === source.prepared &&
    proof.sourceProject === source.prepared.project &&
    proof.sourceJob === source.prepared.job &&
    proof.sourceRunId === source.runId &&
    fingerprintsEqual(proof.sourceFingerprint, source.fingerprint) &&
    proof.metadata === sourceMetadataKey(source)
  );
}

function sourceMetadataKey(source: ExecutionArtifactV1): string {
  return JSON.stringify([
    source.machineKind,
    source.controller,
    serializeCanonicalDeviceProfile(source.prepared.project.device),
    source.prepared.project.machine,
    source.prepared.jobOriginOffset,
    source.provenance,
    source.outputScope,
    source.jobOrigin,
    source.laserResumeChain,
    source.laserSecondPassChain,
    source.archivedControllerObservation,
  ]);
}

function captureVerifiedPreparation(prepared: PreparedStartProgram): PreparedStartProgram {
  const { manifest, ...canvasMetadata } = prepared.canvasPlan;
  const project = prepared.prepared.project;
  return {
    ...prepared,
    warnings: [...prepared.warnings],
    prepared: {
      ...prepared.prepared,
      project: {
        ...project,
        device: structuredClone(project.device),
        ...(project.machine === undefined ? {} : { machine: structuredClone(project.machine) }),
      },
      jobOriginOffset: structuredClone(prepared.prepared.jobOriginOffset),
    },
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: structuredClone(prepared.jobOrigin) }),
    metrics: structuredClone(prepared.metrics),
    canvasPlan: { ...structuredClone(canvasMetadata), manifest },
  };
}
