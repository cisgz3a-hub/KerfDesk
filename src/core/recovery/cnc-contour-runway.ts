import type { CncContourPass, CncGroup, Job } from '../job';
import type { CncCoolantMode, Vec2 } from '../scene';
import {
  buildCncRecoveryEventManifest,
  type CncRecoveryEvent,
  type CncRecoveryEventManifest,
} from './cnc-recovery-manifest';
import {
  backtrackContourPolyline,
  clearedContourDistanceMm,
  clearedTangentDistanceMm,
  isClearedDistanceSufficient,
  isFiniteContourPolyline,
  isValidRunwayProfile,
  requiredContourRunwayMm,
  type CncRunwayProfile,
} from './cnc-contour-runway-geometry';
import { recoveryEventsEqual, resolveContourSource } from './cnc-contour-runway-source';

export type { CncRunwayProfile } from './cnc-contour-runway-geometry';

export type CncContourRunwayPlan = {
  readonly kind: 'review-plan';
  readonly executable: false;
  readonly eventId: string;
  readonly operationId: string;
  readonly passId: string;
  readonly requiredRunwayMm: number;
  readonly availableClearedMm: number;
  readonly runwayPolyline: ReadonlyArray<Vec2>;
  readonly recoveryPolyline: ReadonlyArray<Vec2>;
  readonly uncertaintyStartPointIndex: number;
  readonly source: {
    readonly groupIndex: number;
    readonly passIndex: number;
    readonly segmentIndex: number;
  };
  readonly motion: {
    readonly cutZMm: number;
    readonly safeZMm: number;
    readonly feedMmPerMin: number;
    readonly plungeMmPerMin: number;
    readonly spindleRpm: number;
    readonly spindleSpinupSec: number;
    readonly coolant: CncCoolantMode;
    readonly toolKey: string;
  };
};

type CncContourRunwayErrorReason =
  | 'event-not-found'
  | 'event-not-runway-eligible'
  | 'source-mismatch'
  | 'unsupported-pass'
  | 'first-segment-unproved'
  | 'cleared-path-unproved'
  | 'invalid-profile'
  | 'invalid-geometry'
  | 'invalid-motion';

export type CncContourRunwayResult =
  | CncContourRunwayPlan
  | { readonly kind: 'error'; readonly reason: CncContourRunwayErrorReason }
  | {
      readonly kind: 'error';
      readonly reason: 'insufficient-cleared-distance' | 'non-tangent-runway';
      readonly requiredRunwayMm: number;
      readonly availableClearedMm: number;
    };

export type CncContourRunwayRequest = {
  readonly job: Job;
  readonly manifest: CncRecoveryEventManifest;
  readonly uncertaintyEventId: string;
  readonly profile: CncRunwayProfile;
  readonly clearedPathEvidence: {
    readonly kind: 'committed-through-event';
    readonly eventId: string;
    readonly proofId: string;
  };
};

/** Builds non-executable review geometry; it emits no G-code and commands no machine motion. */
export function planCncContourRunway(request: CncContourRunwayRequest): CncContourRunwayResult {
  if (!isValidRunwayProfile(request.profile)) return { kind: 'error', reason: 'invalid-profile' };
  const event = request.manifest.events.find(
    (candidate) => candidate.id === request.uncertaintyEventId,
  );
  if (event === undefined) return { kind: 'error', reason: 'event-not-found' };
  const canonicalEvent = buildCncRecoveryEventManifest(request.job).events.find(
    (candidate) => candidate.id === request.uncertaintyEventId,
  );
  if (canonicalEvent === undefined || !recoveryEventsEqual(event, canonicalEvent)) {
    return { kind: 'error', reason: 'source-mismatch' };
  }
  if (event.intent !== 'cut' || event.recoverySupport !== 'runway-v1') {
    return { kind: 'error', reason: 'event-not-runway-eligible' };
  }
  const source = resolveContourSource(request.job, event);
  if (source.kind === 'error') return source;
  return buildPlan(
    request.profile,
    request.clearedPathEvidence,
    event,
    source.group,
    source.pass,
    source.segmentIndex,
  );
}

function buildPlan(
  profile: CncRunwayProfile,
  clearedPathEvidence: CncContourRunwayRequest['clearedPathEvidence'],
  event: CncRecoveryEvent,
  group: CncGroup,
  pass: CncContourPass,
  segmentIndex: number,
): CncContourRunwayResult {
  if (!isFiniteContourPolyline(pass.polyline) || !Number.isFinite(pass.zMm)) {
    return { kind: 'error', reason: 'invalid-geometry' };
  }
  if (!isValidMotion(group)) return { kind: 'error', reason: 'invalid-motion' };
  if (segmentIndex === 0) return { kind: 'error', reason: 'first-segment-unproved' };
  if (!hasClearedPathProof(clearedPathEvidence, event, segmentIndex)) {
    return { kind: 'error', reason: 'cleared-path-unproved' };
  }
  const requiredRunwayMm = requiredContourRunwayMm(profile, group.feedMmPerMin);
  const totalClearedMm = clearedContourDistanceMm(pass.polyline, segmentIndex);
  const availableClearedMm = clearedTangentDistanceMm(pass.polyline, segmentIndex);
  if (!isClearedDistanceSufficient(availableClearedMm, requiredRunwayMm)) {
    return {
      kind: 'error',
      reason: isClearedDistanceSufficient(totalClearedMm, requiredRunwayMm)
        ? 'non-tangent-runway'
        : 'insufficient-cleared-distance',
      requiredRunwayMm,
      availableClearedMm,
    };
  }
  const runwayPolyline = backtrackContourPolyline(pass.polyline, segmentIndex, requiredRunwayMm);
  if (runwayPolyline === null) return { kind: 'error', reason: 'invalid-geometry' };
  return successfulPlan(
    event,
    group,
    pass,
    segmentIndex,
    requiredRunwayMm,
    availableClearedMm,
    runwayPolyline,
  );
}

function hasClearedPathProof(
  evidence: CncContourRunwayRequest['clearedPathEvidence'],
  event: CncRecoveryEvent,
  segmentIndex: number,
): boolean {
  const expectedPriorEventId = `${event.passId}/cut-${segmentIndex}`;
  return evidence.eventId === expectedPriorEventId && evidence.proofId.trim().length > 0;
}

function successfulPlan(
  event: CncRecoveryEvent,
  group: CncGroup,
  pass: CncContourPass,
  segmentIndex: number,
  requiredRunwayMm: number,
  availableClearedMm: number,
  runwayPolyline: ReadonlyArray<Vec2>,
): CncContourRunwayPlan {
  return {
    kind: 'review-plan',
    executable: false,
    eventId: event.id,
    operationId: event.operationId,
    passId: event.passId,
    requiredRunwayMm,
    availableClearedMm,
    runwayPolyline,
    recoveryPolyline: [...runwayPolyline, ...pass.polyline.slice(segmentIndex + 1)],
    uncertaintyStartPointIndex: runwayPolyline.length - 1,
    source: {
      groupIndex: event.source.groupIndex,
      passIndex: event.source.passIndex,
      segmentIndex,
    },
    motion: {
      cutZMm: pass.zMm,
      safeZMm: group.safeZMm,
      feedMmPerMin: group.feedMmPerMin,
      plungeMmPerMin: group.plungeMmPerMin,
      spindleRpm: group.spindleRpm,
      spindleSpinupSec: group.spindleSpinupSec,
      coolant: group.coolant ?? 'off',
      toolKey: event.toolKey,
    },
  };
}

function isValidMotion(group: CncGroup): boolean {
  return (
    Number.isFinite(group.safeZMm) &&
    group.safeZMm >= 0 &&
    Number.isFinite(group.feedMmPerMin) &&
    group.feedMmPerMin > 0 &&
    Number.isFinite(group.plungeMmPerMin) &&
    group.plungeMmPerMin > 0 &&
    Number.isFinite(group.spindleRpm) &&
    group.spindleRpm > 0 &&
    Number.isFinite(group.spindleSpinupSec) &&
    group.spindleSpinupSec > 0
  );
}
