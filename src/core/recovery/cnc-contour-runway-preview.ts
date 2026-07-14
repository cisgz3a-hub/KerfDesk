import type { Job } from '../job';
import type { Vec2 } from '../scene';
import {
  backtrackContourPolyline,
  clearedContourDistanceMm,
  clearedTangentDistanceMm,
  isClearedDistanceSufficient,
  isFiniteContourPolyline,
  isValidRunwayParameters,
  requiredContourRunwayMm,
  type CncRunwayParameters,
} from './cnc-contour-runway-geometry';
import { recoveryEventsEqual, resolveContourSource } from './cnc-contour-runway-source';
import {
  buildCncRecoveryEventManifest,
  type CncRecoveryEventManifest,
} from './cnc-recovery-manifest';

export type CncContourRunwayPreview = {
  readonly kind: 'preview';
  readonly executable: false;
  readonly eventId: string;
  readonly requiredRunwayMm: number;
  readonly availableClearedMm: number;
  readonly runwayPolyline: ReadonlyArray<Vec2>;
  readonly recoveryPolyline: ReadonlyArray<Vec2>;
  readonly uncertaintySegment: readonly [Vec2, Vec2];
  readonly feedMmPerMin: number;
  readonly cutZMm: number;
  readonly toolKey: string;
};

export type CncContourRunwayPreviewResult =
  | CncContourRunwayPreview
  | {
      readonly kind: 'error';
      readonly reason:
        | 'event-not-found'
        | 'event-not-runway-eligible'
        | 'source-mismatch'
        | 'unsupported-pass'
        | 'first-segment-has-no-runway'
        | 'invalid-parameters'
        | 'invalid-geometry'
        | 'invalid-feed';
    }
  | {
      readonly kind: 'error';
      readonly reason: 'insufficient-cleared-distance' | 'non-tangent-runway';
      readonly requiredRunwayMm: number;
      readonly availableClearedMm: number;
    };

export function previewCncContourRunway(request: {
  readonly job: Job;
  readonly manifest: CncRecoveryEventManifest;
  readonly uncertaintyEventId: string;
  readonly parameters: CncRunwayParameters;
}): CncContourRunwayPreviewResult {
  if (!isValidRunwayParameters(request.parameters)) {
    return { kind: 'error', reason: 'invalid-parameters' };
  }
  const validated = validatePreviewEvent(request);
  if (validated.kind === 'error') return validated;
  return buildPreview(request.parameters, validated.event, validated.source);
}

function validatePreviewEvent(request: {
  readonly job: Job;
  readonly manifest: CncRecoveryEventManifest;
  readonly uncertaintyEventId: string;
}):
  | {
      readonly kind: 'ok';
      readonly event: CncRecoveryEventManifest['events'][number];
      readonly source: Extract<ReturnType<typeof resolveContourSource>, { readonly kind: 'ok' }>;
    }
  | Extract<CncContourRunwayPreviewResult, { readonly kind: 'error' }> {
  const event = request.manifest.events.find(({ id }) => id === request.uncertaintyEventId);
  if (event === undefined) return { kind: 'error', reason: 'event-not-found' };
  const canonical = buildCncRecoveryEventManifest(request.job).events.find(
    ({ id }) => id === request.uncertaintyEventId,
  );
  if (canonical === undefined || !recoveryEventsEqual(event, canonical)) {
    return { kind: 'error', reason: 'source-mismatch' };
  }
  if (event.intent !== 'cut' || event.recoverySupport !== 'runway-v1') {
    return { kind: 'error', reason: 'event-not-runway-eligible' };
  }
  const source = resolveContourSource(request.job, event);
  if (source.kind === 'error') return source;
  return { kind: 'ok', event, source };
}

function buildPreview(
  parameters: CncRunwayParameters,
  event: CncRecoveryEventManifest['events'][number],
  source: Extract<ReturnType<typeof resolveContourSource>, { readonly kind: 'ok' }>,
): CncContourRunwayPreviewResult {
  const { group, pass, segmentIndex } = source;
  if (!isFiniteContourPolyline(pass.polyline) || !Number.isFinite(pass.zMm)) {
    return { kind: 'error', reason: 'invalid-geometry' };
  }
  if (!Number.isFinite(group.feedMmPerMin) || group.feedMmPerMin <= 0) {
    return { kind: 'error', reason: 'invalid-feed' };
  }
  if (segmentIndex === 0) return { kind: 'error', reason: 'first-segment-has-no-runway' };
  const requiredRunwayMm = requiredContourRunwayMm(parameters, group.feedMmPerMin);
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
  const start = pass.polyline[segmentIndex];
  const end = pass.polyline[segmentIndex + 1];
  if (runwayPolyline === null || start === undefined || end === undefined) {
    return { kind: 'error', reason: 'invalid-geometry' };
  }
  return {
    kind: 'preview',
    executable: false,
    eventId: event.id,
    requiredRunwayMm,
    availableClearedMm,
    runwayPolyline,
    recoveryPolyline: [...runwayPolyline, ...pass.polyline.slice(segmentIndex + 1)],
    uncertaintySegment: [start, end],
    feedMmPerMin: group.feedMmPerMin,
    cutZMm: pass.zMm,
    toolKey: event.toolKey,
  };
}
