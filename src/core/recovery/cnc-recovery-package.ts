import type { Job } from '../job';
import type { CncContourRunwayPlan, CncRunwayProfile } from './cnc-contour-runway';
import {
  buildCncRecoveryEventManifest,
  validateCncRecoveryLineSpans,
  type CncRecoveryEventManifest,
  type CncRecoveryLineSpan,
} from './cnc-recovery-manifest';

export const CNC_RECOVERY_PACKAGE_SCHEMA_VERSION = 1;

export type CncRecoveryPackageInput = {
  readonly job: Job;
  readonly gcode: string;
  readonly manifest: CncRecoveryEventManifest;
  readonly lineSpans: ReadonlyArray<CncRecoveryLineSpan>;
  readonly emitterRevision: string;
  readonly machineProfileFingerprint: string;
  readonly toolPlanFingerprint: string;
  readonly wcsFingerprint: string;
  readonly jobOriginFingerprint: string;
  readonly stockFingerprint: string;
  readonly fixtureFingerprint: string;
};

export type CncRecoveryPackageIdentity = {
  readonly schemaVersion: typeof CNC_RECOVERY_PACKAGE_SCHEMA_VERSION;
  readonly algorithm: 'sha256';
  readonly digest: `sha256:${string}`;
};

export type CncRecoveryPackageIdentityResult =
  | { readonly kind: 'ok'; readonly identity: CncRecoveryPackageIdentity }
  | {
      readonly kind: 'error';
      readonly reason: 'sha256-unavailable' | 'invalid-line-map' | 'invalid-manifest';
    };

export type CncSupervisedRecoveryPackageInput = {
  readonly sourceGcode: string;
  readonly recoveryGcode: string;
  readonly plan: CncContourRunwayPlan;
  readonly profile: CncRunwayProfile;
  readonly reviewId: string;
  readonly clearedPathProofId: string;
  readonly completedPrefixProofId: string;
};

/** Hashes every field that must remain exact before a recovery job is reviewed. */
export async function createCncRecoveryPackageIdentity(
  input: CncRecoveryPackageInput,
): Promise<CncRecoveryPackageIdentityResult> {
  const canonical = buildCncRecoveryEventManifest(input.job);
  if (!manifestsEqual(input.manifest, canonical)) {
    return { kind: 'error', reason: 'invalid-manifest' };
  }
  const lineMap = validateCncRecoveryLineSpans(
    canonical,
    input.lineSpans,
    input.gcode.split('\n').length,
  );
  if (lineMap.kind === 'error') return { kind: 'error', reason: 'invalid-line-map' };
  return sha256Identity(canonicalPackagePayload(input, canonical, lineMap.spans));
}

/**
 * Binds an explicitly selected semantic recovery point to both the exact
 * interrupted program and the newly generated recovery program. Unlike the
 * automatic line-map package, this path does not interpret acknowledgement
 * counts; the operator-selected event and cleared-path proof are hashed in.
 */
export async function createCncSupervisedRecoveryPackageIdentity(
  input: CncSupervisedRecoveryPackageInput,
): Promise<CncRecoveryPackageIdentityResult> {
  return sha256Identity(canonicalSupervisedPackagePayload(input));
}

async function sha256Identity(payload: string): Promise<CncRecoveryPackageIdentityResult> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return { kind: 'error', reason: 'sha256-unavailable' };
  try {
    const bytes = new TextEncoder().encode(payload);
    const digest = await subtle.digest('SHA-256', bytes);
    return {
      kind: 'ok',
      identity: {
        schemaVersion: CNC_RECOVERY_PACKAGE_SCHEMA_VERSION,
        algorithm: 'sha256',
        digest: `sha256:${hexBytes(digest)}`,
      },
    };
  } catch {
    return { kind: 'error', reason: 'sha256-unavailable' };
  }
}

export function cncRecoveryPackageIdentitiesEqual(
  left: CncRecoveryPackageIdentity,
  right: CncRecoveryPackageIdentity,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.algorithm === right.algorithm &&
    left.digest === right.digest
  );
}

function canonicalPackagePayload(
  input: CncRecoveryPackageInput,
  manifest: CncRecoveryEventManifest,
  lineSpans: ReadonlyArray<CncRecoveryLineSpan>,
): string {
  const fields: ReadonlyArray<readonly [string, string]> = [
    ['schema', String(CNC_RECOVERY_PACKAGE_SCHEMA_VERSION)],
    ['gcode', input.gcode],
    ['manifest', canonicalManifest(manifest)],
    ['line-map', canonicalLineSpans(lineSpans)],
    ['emitter', input.emitterRevision],
    ['machine', input.machineProfileFingerprint],
    ['tools', input.toolPlanFingerprint],
    ['wcs', input.wcsFingerprint],
    ['origin', input.jobOriginFingerprint],
    ['stock', input.stockFingerprint],
    ['fixtures', input.fixtureFingerprint],
  ];
  return fields.map(([name, value]) => lengthPrefix(name) + lengthPrefix(value)).join('');
}

function canonicalSupervisedPackagePayload(input: CncSupervisedRecoveryPackageInput): string {
  const fields: ReadonlyArray<readonly [string, string]> = [
    ['schema', String(CNC_RECOVERY_PACKAGE_SCHEMA_VERSION)],
    ['mode', 'supervised-explicit-event-v1'],
    ['source-gcode', input.sourceGcode],
    ['recovery-gcode', input.recoveryGcode],
    ['event', input.plan.eventId],
    ['operation', input.plan.operationId],
    ['pass', input.plan.passId],
    ['source', JSON.stringify(input.plan.source)],
    ['runway', JSON.stringify(input.plan.runwayPolyline)],
    ['recovery-path', JSON.stringify(input.plan.recoveryPolyline)],
    ['uncertainty-index', String(input.plan.uncertaintyStartPointIndex)],
    ['motion', JSON.stringify(input.plan.motion)],
    ['required-runway-mm', String(input.plan.requiredRunwayMm)],
    ['available-cleared-mm', String(input.plan.availableClearedMm)],
    ['profile', JSON.stringify(input.profile)],
    ['operator-review', input.reviewId],
    ['cleared-path-proof', input.clearedPathProofId],
    ['completed-prefix-proof', input.completedPrefixProofId],
  ];
  return fields.map(([name, value]) => lengthPrefix(name) + lengthPrefix(value)).join('');
}

function manifestsEqual(left: CncRecoveryEventManifest, right: CncRecoveryEventManifest): boolean {
  return canonicalManifest(left) === canonicalManifest(right);
}

function canonicalLineSpans(spans: ReadonlyArray<CncRecoveryLineSpan>): string {
  return JSON.stringify(spans.map((span) => [span.eventId, span.firstRawLine, span.lastRawLine]));
}

function canonicalManifest(manifest: CncRecoveryEventManifest): string {
  return JSON.stringify([
    manifest.schemaVersion,
    manifest.events.map((event) => [
      event.id,
      event.operationId,
      event.passId,
      event.intent,
      event.recoverySupport,
      event.toolKey,
      event.source.groupIndex,
      event.source.passIndex,
      event.source.segmentIndex,
      event.source.passKind,
    ]),
  ]);
}

function lengthPrefix(value: string): string {
  return `${value.length}:${value}`;
}

function hexBytes(buffer: ArrayBuffer): string {
  const hexRadix = 16;
  const byteHexWidth = 2;
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(hexRadix).padStart(byteHexWidth, '0'))
    .join('');
}
