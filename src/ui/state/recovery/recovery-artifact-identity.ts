import {
  isExecutionArtifact,
  isLegacyFingerprintArtifact,
  type LegacyFingerprintOnlyArtifactV1,
  type RecoveryArtifactV1,
} from './execution-artifact';
import { storedExecutionArtifactIntegrityIsValid } from './execution-artifact-integrity';
import type { RecoveryStorageBackend } from './recovery-backend';
import { validStoredArtifact } from './recovery-model';

export async function matchesStoredArtifact(
  backend: RecoveryStorageBackend,
  generation: number,
  artifact: RecoveryArtifactV1,
): Promise<boolean> {
  const stored = validStoredArtifact(await backend.getArtifact(artifact.runId));
  if (stored === null || stored.generation !== generation) return false;
  const existing = stored.artifact;
  if (existing.kind !== artifact.kind) return false;
  if (existing.kind === 'legacy-fingerprint-only') {
    return legacyStoredArtifactMatches(existing, artifact);
  }
  return (
    artifact.kind === 'exact-execution' &&
    isExecutionArtifact(existing) &&
    (await storedExecutionArtifactIntegrityIsValid(stored)) &&
    existing.createdAtIso === artifact.createdAtIso &&
    existing.executionSignature === artifact.executionSignature &&
    sameProvenanceIdentity(existing, artifact) &&
    existing.gcode === artifact.gcode
  );
}

function legacyStoredArtifactMatches(
  existing: RecoveryArtifactV1,
  candidate: RecoveryArtifactV1,
): boolean {
  if (!isLegacyFingerprintArtifact(existing)) return false;
  if (candidate.kind !== 'legacy-fingerprint-only') return false;
  return sameLegacyFingerprintIdentity(existing, candidate);
}

function sameLegacyFingerprintIdentity(
  left: LegacyFingerprintOnlyArtifactV1,
  right: LegacyFingerprintOnlyArtifactV1,
): boolean {
  return (
    left.createdAtIso === right.createdAtIso &&
    left.sendableLines === right.sendableLines &&
    left.machineKind === right.machineKind &&
    left.fingerprint.fnv1a === right.fingerprint.fnv1a &&
    left.fingerprint.chars === right.fingerprint.chars &&
    left.fingerprint.lines === right.fingerprint.lines &&
    sameOutputScope(left.outputScope, right.outputScope) &&
    sameJobOrigin(left.jobOrigin, right.jobOrigin)
  );
}

function sameOutputScope(
  left: LegacyFingerprintOnlyArtifactV1['outputScope'],
  right: LegacyFingerprintOnlyArtifactV1['outputScope'],
): boolean {
  return (
    left.cutSelectedGraphics === right.cutSelectedGraphics &&
    left.useSelectionOrigin === right.useSelectionOrigin &&
    left.selectedObjectIds.length === right.selectedObjectIds.length &&
    left.selectedObjectIds.every((id, index) => id === right.selectedObjectIds[index])
  );
}

function sameJobOrigin(
  left: LegacyFingerprintOnlyArtifactV1['jobOrigin'],
  right: LegacyFingerprintOnlyArtifactV1['jobOrigin'],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.startFrom !== right.startFrom || left.anchor !== right.anchor) return false;
  if (left.startFrom !== 'current-position' || right.startFrom !== 'current-position') return true;
  return (
    left.currentPosition.x === right.currentPosition.x &&
    left.currentPosition.y === right.currentPosition.y
  );
}

function sameProvenanceIdentity(
  left: Extract<RecoveryArtifactV1, { readonly kind: 'exact-execution' }>,
  right: Extract<RecoveryArtifactV1, { readonly kind: 'exact-execution' }>,
): boolean {
  const leftProvenance = left.provenance;
  const rightProvenance = right.provenance;
  if (leftProvenance?.schemaVersion !== rightProvenance?.schemaVersion) return false;
  if (leftProvenance?.schemaVersion !== 2 || rightProvenance?.schemaVersion !== 2) return true;
  return leftProvenance.envelopeSha256 === rightProvenance.envelopeSha256;
}
