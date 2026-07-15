import type { Job } from '../../core/job';
import { fingerprintGcode, fingerprintsEqual, type JobCheckpoint } from '../../core/recovery';
import {
  previewCncContourRunway,
  type CncContourRunwayPreviewResult,
} from '../../core/recovery/cnc-contour-runway-preview';
import { recoveryEventsEqual } from '../../core/recovery/cnc-contour-runway-source';
import {
  buildCncRecoveryEventManifest,
  type CncRecoveryEvent,
  type CncRecoveryEventManifest,
} from '../../core/recovery/cnc';
import {
  isValidRunwayParameters,
  type CncRunwayParameters,
} from '../../core/recovery/cnc-contour-runway-geometry';
import { cncSupervisedRecoveryRunwayProfile } from '../../core/recovery/cnc-supervised-recovery-job';
import type { Project } from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import type { RecoveryCapsule } from '../state/recovery';
import { recoveryArtifactPreparedProgramMatches } from './recovery-artifact-binding';

export type CncRecoveryEvidenceCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: 'matched' | 'diagnostic' | 'missing' | 'mismatch';
  readonly detail: string;
};

export type CncRecoveryPreviewEvent = {
  readonly id: string;
  readonly label: string;
};

export type CncRecoveryPreviewModel = {
  readonly canExecute: boolean;
  readonly unavailableReason: string | null;
  readonly parameters: CncRunwayParameters;
  readonly checks: ReadonlyArray<CncRecoveryEvidenceCheck>;
  readonly events: ReadonlyArray<CncRecoveryPreviewEvent>;
  readonly selectedEventId: string | null;
  readonly geometry: CncContourRunwayPreviewResult | null;
};

type LegacyPreviewRecord = Pick<
  JobCheckpoint,
  'fingerprint' | 'machineKind' | 'outputScope' | 'jobOrigin' | 'ackedLines' | 'sendableLines'
>;
type EvidenceStatus = CncRecoveryEvidenceCheck['status'];

/** Exact capsules are reviewed only from their sealed execution artifact. */
export function buildCncRecoveryPreviewModel(
  capsule: RecoveryCapsule,
  requestedEventId?: string,
): CncRecoveryPreviewModel;
/** @deprecated Migration shim for the pre-capsule CNC wizard. */
export function buildCncRecoveryPreviewModel(
  project: Project,
  checkpoint: JobCheckpoint,
  requestedEventId?: string,
): CncRecoveryPreviewModel;
export function buildCncRecoveryPreviewModel(
  capsuleOrProject: RecoveryCapsule | Project,
  checkpointOrEventId?: JobCheckpoint | string,
  legacyEventId?: string,
): CncRecoveryPreviewModel {
  if (isCapsule(capsuleOrProject)) {
    const eventId = typeof checkpointOrEventId === 'string' ? checkpointOrEventId : undefined;
    return buildCapsulePreview(capsuleOrProject, eventId);
  }
  return buildLegacyPreview(capsuleOrProject, checkpointOrEventId as JobCheckpoint, legacyEventId);
}

/**
 * Explicit compatibility boundary for migrated fingerprint-only records.
 * This is the only preview path allowed to compile the open project.
 */
export function buildLegacyFingerprintOnlyCncRecoveryPreviewModel(
  project: Project,
  capsuleOrCheckpoint: RecoveryCapsule | JobCheckpoint,
  requestedEventId?: string,
): CncRecoveryPreviewModel {
  const record = legacyRecord(capsuleOrCheckpoint);
  if (record === null) {
    return unavailable(
      [],
      'This capsule contains an exact artifact and must use sealed-artifact recovery review.',
      recoveryParameters(project),
    );
  }
  return buildLegacyPreview(project, record, requestedEventId);
}

function buildCapsulePreview(
  capsule: RecoveryCapsule,
  requestedEventId: string | undefined,
): CncRecoveryPreviewModel {
  const artifact = capsule.artifact;
  if (artifact.kind === 'legacy-fingerprint-only') {
    return unavailable(
      legacyEvidenceChecks(capsule),
      'This migrated fingerprint-only record requires the explicit legacy current-project fallback.',
      recoveryParametersFromAcceleration(100),
    );
  }
  const parameters = recoveryParameters(artifact.prepared.project);
  const identityMatches = exactIdentityMatches(capsule);
  const preparedProgramMatches = recoveryArtifactPreparedProgramMatches(artifact);
  const manifest = artifact.cncRecoveryManifest;
  const manifestMatches =
    manifest !== undefined && manifestMatchesJob(artifact.prepared.job, manifest);
  const checks = exactEvidenceChecks(
    capsule,
    identityMatches,
    preparedProgramMatches,
    manifest !== undefined,
    manifestMatches,
  );
  if (artifact.machineKind !== 'cnc' || artifact.prepared.project.machine?.kind !== 'cnc') {
    return unavailable(checks, 'The saved execution artifact is not a CNC job.', parameters);
  }
  if (!isValidRunwayParameters(parameters)) {
    return unavailable(
      checks,
      'The archived device acceleration setting is invalid, so a recovery runway cannot be qualified.',
      parameters,
    );
  }
  if (!identityMatches) {
    return unavailable(
      checks,
      'The saved execution artifact failed its run identity check.',
      parameters,
    );
  }
  if (!preparedProgramMatches) {
    return unavailable(
      checks,
      'The archived prepared job does not reproduce the sealed exact G-code.',
      parameters,
    );
  }
  if (manifest === undefined || !manifestMatches) {
    return unavailable(
      checks,
      'The saved semantic recovery manifest is missing or does not match its archived prepared job.',
      parameters,
    );
  }
  return buildSemanticPreview(
    artifact.prepared.job,
    manifest,
    parameters,
    checks,
    requestedEventId,
  );
}

function buildLegacyPreview(
  project: Project,
  checkpoint: LegacyPreviewRecord,
  requestedEventId: string | undefined,
): CncRecoveryPreviewModel {
  const parameters = recoveryParameters(project);
  const base = legacyEvidenceChecks(checkpoint);
  if (!isValidRunwayParameters(parameters)) {
    return unavailable(base, 'The device acceleration setting is invalid.', parameters);
  }
  if (checkpoint.machineKind !== 'cnc' || project.machine?.kind !== 'cnc') {
    return unavailable(base, 'Open the original CNC project for this legacy record.', parameters);
  }
  const prepared = prepareOutput(project, {
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  });
  if (!prepared.ok) {
    return unavailable(base, 'The current project cannot compile this legacy record.', parameters);
  }
  const emitted = emitPreparedGcode(prepared, {
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  });
  if (!emitted.preflight.ok) {
    return unavailable(base, 'The current project fails CNC preflight.', parameters);
  }
  const programMatches = fingerprintsEqual(fingerprintGcode(emitted.gcode), checkpoint.fingerprint);
  const checks = [legacyProgramIdentityCheck(programMatches), ...base];
  if (!programMatches) {
    return unavailable(
      checks,
      'The current project does not reproduce the legacy interrupted program.',
      parameters,
    );
  }
  return buildSemanticPreview(
    prepared.job,
    buildCncRecoveryEventManifest(prepared.job),
    parameters,
    checks,
    requestedEventId,
  );
}

function buildSemanticPreview(
  job: Job,
  manifest: CncRecoveryEventManifest,
  parameters: CncRunwayParameters,
  checks: ReadonlyArray<CncRecoveryEvidenceCheck>,
  requestedEventId: string | undefined,
): CncRecoveryPreviewModel {
  const candidates = manifest.events.filter(isPreviewCandidate);
  const events = candidates.map((event) => ({ id: event.id, label: eventLabel(event) }));
  const selectedEventId =
    requestedEventId !== undefined && events.some(({ id }) => id === requestedEventId)
      ? requestedEventId
      : null;
  const geometry =
    selectedEventId === null
      ? null
      : previewCncContourRunway({ job, manifest, uncertaintyEventId: selectedEventId, parameters });
  return {
    canExecute: geometry?.kind === 'preview',
    unavailableReason:
      events.length === 0
        ? 'This job has no single-tool native contour segment eligible for runway preview.'
        : null,
    checks,
    parameters,
    events,
    selectedEventId,
    geometry,
  };
}

function exactEvidenceChecks(
  capsule: RecoveryCapsule,
  identityMatches: boolean,
  preparedProgramMatches: boolean,
  manifestPresent: boolean,
  manifestMatches: boolean,
): ReadonlyArray<CncRecoveryEvidenceCheck> {
  const manifestStatus = !manifestPresent
    ? 'missing'
    : preparedProgramMatches && manifestMatches
      ? 'matched'
      : 'mismatch';
  const manifestDescription = !manifestPresent
    ? 'The exact capsule has no CNC recovery manifest.'
    : !preparedProgramMatches
      ? 'The archived prepared job does not reproduce the sealed exact G-code.'
      : manifestMatches
        ? 'The emitter-owned semantic job and recovery manifest are sealed together in the capsule.'
        : 'The archived manifest does not match the archived prepared semantic job.';
  return [
    evidence(
      'program-identity',
      'Saved execution artifact identity',
      identityMatches ? 'matched' : 'mismatch',
      identityMatches
        ? 'The exact emitted G-code and immutable run identity are retained in the capsule.'
        : 'The capsule run identity, progress total, or archived G-code fingerprint is inconsistent.',
    ),
    acknowledgementCheck(capsule),
    evidence(
      'semantic-line-map',
      'Archived prepared job and recovery manifest',
      manifestStatus,
      manifestDescription,
    ),
    executionFenceCheck,
    evidence(
      'machine-state',
      'Archived controller observations',
      'diagnostic',
      'Retained settings, position, tool, and Work Z observations are diagnostics only; the live controller must be requalified.',
    ),
    runwayQualificationCheck,
  ];
}

function legacyEvidenceChecks(
  checkpoint: Pick<LegacyPreviewRecord, 'ackedLines' | 'sendableLines'>,
): ReadonlyArray<CncRecoveryEvidenceCheck> {
  return [
    acknowledgementCheck(checkpoint),
    evidence(
      'semantic-line-map',
      'Archived prepared job and recovery manifest',
      'missing',
      'This legacy fingerprint-only record predates the sealed semantic artifact.',
    ),
    executionFenceCheck,
    evidence(
      'machine-state',
      'Position, spindle, tool, and workholding',
      'missing',
      'No retained-session physical execution proof is attached.',
    ),
    runwayQualificationCheck,
  ];
}

function acknowledgementCheck(
  progress: Pick<LegacyPreviewRecord, 'ackedLines' | 'sendableLines'>,
): CncRecoveryEvidenceCheck {
  return evidence(
    'acknowledgements',
    'Controller acknowledgements',
    'diagnostic',
    `${progress.ackedLines} of ${progress.sendableLines} lines were acknowledged; this does not prove physical execution.`,
  );
}

const executionFenceCheck = evidence(
  'execution-fence',
  'Controller execution fence',
  'missing',
  'No controller-owned proof identifies the last physically completed contour segment.',
);
const runwayQualificationCheck = evidence(
  'machine-profile',
  'Hardware-qualified runway profile',
  'missing',
  'The displayed acceleration and margin are illustrative, not machine qualification.',
);

function legacyProgramIdentityCheck(matches: boolean): CncRecoveryEvidenceCheck {
  return evidence(
    'program-identity',
    'Legacy interrupted program identity',
    matches ? 'matched' : 'mismatch',
    matches
      ? 'The current project recompiles to the legacy G-code fingerprint.'
      : 'The current project produces different G-code from the legacy record.',
  );
}

function evidence(
  id: string,
  label: string,
  status: EvidenceStatus,
  detail: string,
): CncRecoveryEvidenceCheck {
  return { id, label, status, detail };
}

function exactIdentityMatches(capsule: RecoveryCapsule): boolean {
  const artifact = capsule.artifact;
  return (
    artifact.kind === 'exact-execution' &&
    capsule.runId === artifact.runId &&
    capsule.artifactKind === artifact.kind &&
    capsule.sendableLines === artifact.sendableLines &&
    fingerprintsEqual(fingerprintGcode(artifact.gcode), artifact.fingerprint)
  );
}

function manifestMatchesJob(job: Job, manifest: CncRecoveryEventManifest): boolean {
  const canonical = buildCncRecoveryEventManifest(job);
  return (
    canonical.events.length === manifest.events.length &&
    canonical.events.every((event, index) => {
      const archived = manifest.events[index];
      return archived !== undefined && recoveryEventsEqual(event, archived);
    })
  );
}

function legacyRecord(value: RecoveryCapsule | JobCheckpoint): LegacyPreviewRecord | null {
  if (!isCapsule(value)) return value;
  const artifact = value.artifact;
  if (artifact.kind !== 'legacy-fingerprint-only') return null;
  return {
    fingerprint: artifact.fingerprint,
    machineKind: artifact.machineKind,
    outputScope: artifact.outputScope,
    ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
    ackedLines: value.ackedLines,
    sendableLines: value.sendableLines,
  };
}

function unavailable(
  checks: ReadonlyArray<CncRecoveryEvidenceCheck>,
  unavailableReason: string,
  parameters: CncRunwayParameters,
): CncRecoveryPreviewModel {
  return {
    canExecute: false,
    unavailableReason,
    parameters,
    checks,
    events: [],
    selectedEventId: null,
    geometry: null,
  };
}

function isPreviewCandidate(event: CncRecoveryEvent): boolean {
  return (
    event.intent === 'cut' &&
    event.recoverySupport === 'runway-v1' &&
    event.source.segmentIndex !== null &&
    event.source.segmentIndex > 0
  );
}

function eventLabel(event: CncRecoveryEvent): string {
  const segment = (event.source.segmentIndex ?? 0) + 1;
  return `${event.operationId} / pass ${event.source.passIndex + 1} / segment ${segment} / ${event.toolKey}`;
}

function recoveryParameters(project: Project): CncRunwayParameters {
  return recoveryParametersFromAcceleration(project.device.accelMmPerSec2);
}

function recoveryParametersFromAcceleration(acceleration: number): CncRunwayParameters {
  const profile = cncSupervisedRecoveryRunwayProfile(acceleration, 'preview');
  return {
    minRunwayMm: profile.minRunwayMm,
    accelerationMmPerSec2: profile.accelerationMmPerSec2,
    safetyMarginMm: profile.safetyMarginMm,
  };
}

function isCapsule(value: RecoveryCapsule | JobCheckpoint | Project): value is RecoveryCapsule {
  return 'artifact' in value && 'artifactKind' in value;
}
