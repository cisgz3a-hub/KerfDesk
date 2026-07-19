import { fingerprintsEqual } from '../../../core/recovery';
import { serializeCanonicalDeviceProfile } from '../../../io/machine-profile/machine-profile-io';
import {
  isCurrentExecutionArtifact,
  isExecutionArtifact,
  LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION,
  type ExecutionArtifactV1,
} from './execution-artifact';
import { CURRENT_EXECUTION_ARTIFACT_ORIGIN, type StoredRecoveryArtifact } from './recovery-model';
import {
  computeArchivedControllerObservationSha256,
  computeExecutionProvenanceEnvelopeSha256,
  isExecutionProvenance,
  sha256Utf8,
} from './execution-provenance';

/** Expensive cryptographic verification for immutable execution artifacts.
 * The synchronous artifact guard validates shape/fingerprint first; this
 * check binds provenance claims to the exact stored G-code and embedded
 * canonical machine profile. Exact schema-v1 artifacts always fail closed:
 * their mutable outer storage record cannot prove that they genuinely predate
 * provenance, even when it carries the old migration-origin label. */
export async function executionArtifactIntegrityIsValid(
  artifact: ExecutionArtifactV1,
): Promise<boolean> {
  if (artifact.schemaVersion === LEGACY_EXECUTION_ARTIFACT_SCHEMA_VERSION) return false;
  const provenance = artifact.provenance;
  if (provenance === undefined) return false;
  if (!isExecutionProvenance(provenance)) return false;
  if (
    provenance.schemaVersion !== 2 ||
    provenance.archivedControllerObservationSha256 === undefined
  ) {
    return false;
  }
  try {
    return await cryptographicBindingsAreValid(artifact);
  } catch {
    return false;
  }
}

/** Verify an exact artifact only after its outer storage record has been
 * parsed. The origin is mutable in IndexedDB, so it narrows valid current
 * records but never authorizes legacy exact execution. */
export async function storedExecutionArtifactIntegrityIsValid(
  record: StoredRecoveryArtifact,
): Promise<boolean> {
  if (!isExecutionArtifact(record.artifact)) return false;
  return (
    record.origin === CURRENT_EXECUTION_ARTIFACT_ORIGIN &&
    isCurrentExecutionArtifact(record.artifact) &&
    executionArtifactIntegrityIsValid(record.artifact)
  );
}

async function cryptographicBindingsAreValid(artifact: ExecutionArtifactV1): Promise<boolean> {
  const provenance = artifact.provenance;
  if (provenance === undefined) return true;
  const profile = artifact.prepared.project.device;
  const canonicalProfile = serializeCanonicalDeviceProfile(profile);
  if (!artifactClaimsMatch(artifact, canonicalProfile)) return false;
  const [gcodeSha256, canonicalProfileSha256, envelopeSha256, observationSha256] =
    await Promise.all([
      sha256Utf8(artifact.gcode),
      sha256Utf8(canonicalProfile),
      provenanceEnvelopeDigest(provenance),
      archivedObservationDigest(artifact),
    ]);
  return (
    provenance.content.gcodeSha256 === gcodeSha256 &&
    provenance.content.canonicalProfileSha256 === canonicalProfileSha256 &&
    provenanceEnvelopeMatches(provenance, envelopeSha256, observationSha256)
  );
}

function artifactClaimsMatch(artifact: ExecutionArtifactV1, canonicalProfile: string): boolean {
  const provenance = artifact.provenance;
  if (provenance === undefined) return true;
  const profile = artifact.prepared.project.device;
  return (
    provenance.content.gcodeUtf8Bytes === utf8Bytes(artifact.gcode) &&
    provenance.content.canonicalProfileUtf8Bytes === utf8Bytes(canonicalProfile) &&
    artifact.controller.streamingMode === profile.streamingMode &&
    artifact.controller.rxBufferBytes === profile.rxBufferBytes &&
    profileIdentityMatches(provenance.content, profile) &&
    workflowMatchesArtifact(artifact)
  );
}

function provenanceEnvelopeDigest(
  provenance: NonNullable<ExecutionArtifactV1['provenance']>,
): Promise<`sha256:${string}` | null> {
  return provenance.schemaVersion === 2
    ? computeExecutionProvenanceEnvelopeSha256(provenance)
    : Promise.resolve(null);
}

function archivedObservationDigest(
  artifact: ExecutionArtifactV1,
): Promise<`sha256:${string}` | null> {
  const provenance = artifact.provenance;
  if (
    provenance === undefined ||
    provenance.schemaVersion === 1 ||
    provenance.archivedControllerObservationSha256 === undefined
  ) {
    return Promise.resolve(null);
  }
  return computeArchivedControllerObservationSha256(artifact.archivedControllerObservation);
}

function provenanceEnvelopeMatches(
  provenance: NonNullable<ExecutionArtifactV1['provenance']>,
  envelopeSha256: `sha256:${string}` | null,
  observationSha256: `sha256:${string}` | null,
): boolean {
  if (provenance.schemaVersion === 1) return true;
  if (provenance.envelopeSha256 !== envelopeSha256) return false;
  return (
    provenance.archivedControllerObservationSha256 === undefined ||
    provenance.archivedControllerObservationSha256 === observationSha256
  );
}

function workflowMatchesArtifact(artifact: ExecutionArtifactV1): boolean {
  const provenance = artifact.provenance;
  if (provenance === undefined || provenance.schemaVersion === 1) return true;
  const workflow = provenance.workflow;
  switch (workflow.kind) {
    case 'ordinary-start':
      return ordinaryWorkflowMatchesArtifact(artifact);
    case 'laser-recovery':
      return laserRecoveryWorkflowMatchesArtifact(artifact, workflow.requestedFromLine);
    case 'cnc-supervised-recovery':
      return cncWorkflowMatchesArtifact(artifact, workflow.qualificationId);
    case 'cnc-pass-recovery':
      return cncWorkflowMatchesArtifact(artifact);
  }
}

function ordinaryWorkflowMatchesArtifact(artifact: ExecutionArtifactV1): boolean {
  const provenance = artifact.provenance;
  if (provenance === undefined || provenance.schemaVersion === 1) return false;
  if (artifact.laserResumeChain !== undefined) return false;
  if (!controllerEvidenceMatchesArtifact(artifact) || !setupFingerprintMatchesArtifact(artifact)) {
    return false;
  }
  const acknowledgement = provenance.review.acknowledgement;
  return artifact.machineKind === 'cnc'
    ? acknowledgement.kind === 'cnc'
    : acknowledgement.kind === 'laser-verified' || acknowledgement.kind === 'laser-unverified';
}

function laserRecoveryWorkflowMatchesArtifact(
  artifact: ExecutionArtifactV1,
  requestedFromLine: number,
): boolean {
  const lastResume = artifact.laserResumeChain?.at(-1);
  return (
    artifact.machineKind === 'laser' &&
    controllerEvidenceMatchesArtifact(artifact) &&
    lastResume?.fromLine === requestedFromLine
  );
}

function cncWorkflowMatchesArtifact(
  artifact: ExecutionArtifactV1,
  requiredQualification?: string,
): boolean {
  return (
    artifact.machineKind === 'cnc' &&
    controllerEvidenceMatchesArtifact(artifact) &&
    setupFingerprintMatchesArtifact(artifact) &&
    (requiredQualification === undefined ||
      artifact.recoveryQualification === requiredQualification)
  );
}

function controllerEvidenceMatchesArtifact(artifact: ExecutionArtifactV1): boolean {
  const provenance = artifact.provenance;
  if (provenance === undefined) return true;
  const archived = artifact.archivedControllerObservation;
  return (
    provenance.controller.activeKind === artifact.controller.kind &&
    (archived.activeControllerKind === undefined ||
      archived.activeControllerKind === provenance.controller.activeKind) &&
    (archived.detectedControllerKind === undefined ||
      archived.detectedControllerKind === provenance.controller.detectedKind) &&
    (archived.controllerSessionEpoch === undefined ||
      archived.controllerSessionEpoch === provenance.controller.sessionEpoch)
  );
}

function setupFingerprintMatchesArtifact(artifact: ExecutionArtifactV1): boolean {
  const provenance = artifact.provenance;
  if (provenance === undefined || provenance.schemaVersion === 1) return true;
  const attestation = provenance.review.cncSetupAttestation;
  return (
    attestation === undefined ||
    fingerprintsEqual(attestation.programFingerprint, artifact.fingerprint)
  );
}

function profileIdentityMatches(
  content: NonNullable<ExecutionArtifactV1['provenance']>['content'],
  profile: ExecutionArtifactV1['prepared']['project']['device'],
): boolean {
  return (
    content.profileName === profile.name &&
    optionalEquals(content.profileId, profile.profileId) &&
    optionalEquals(content.profileSource, profile.profileSource) &&
    optionalEquals(content.catalogVersion, profile.catalogVersion)
  );
}

function optionalEquals(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
