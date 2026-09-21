import { rotaryAppliesTo } from '../../core/job';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import {
  mapControllerPointToScene,
  reportedWorkPositionMm,
  type CanvasMotionPlan,
} from '../state/canvas-motion-plan';
import type { ExecutionArtifactV1 } from '../state/recovery';

const previews = new WeakMap<ExecutionArtifactV1, CanvasMotionPlan>();

/** Called with an artifact verified by the recovery repository. Persisted canvas
 * coordinates are diagnostic data, not part of its cryptographic envelope.
 * Derive selectable movements only from its sealed G-code, profile and historical
 * position observation, never from the stored plain or packed canvas manifest.
 * Archived observations position this preview only; they never qualify Start. */
export function laserRecoveryPreviewPlan(artifact: ExecutionArtifactV1): CanvasMotionPlan {
  const cached = previews.get(artifact);
  if (cached !== undefined) return cached;
  const { initialPosition } = historicalPreviewPosition(artifact.archivedControllerObservation);
  const manifest = buildMotionManifest(artifact.gcode, {
    machineKind: 'laser',
    ...(initialPosition === null ? {} : { initialPosition }),
  });
  const device = artifact.prepared.project.device;
  const mapping = {
    device,
    // Historical WCO is a native offset, not proof of where the bed lies.
    coordinateFrame: {
      kind: 'relative',
      jobOriginOffset: artifact.prepared.jobOriginOffset,
    } as const,
  };
  const rotary = rotaryAppliesTo(device, undefined);
  const fingerprint = fingerprintGcode(artifact.gcode);
  const plan: CanvasMotionPlan = {
    ...mapping,
    manifest,
    fingerprint,
    retentionKey: `recovery-preview:${fingerprint.fnv1a}:${fingerprint.chars}`,
    machineKind: 'laser',
    framePerimeter: [],
    jobStart:
      manifest.firstProcessPoint === null
        ? null
        : mapControllerPointToScene(manifest.firstProcessPoint, mapping),
    approachFrom:
      initialPosition === null ? null : mapControllerPointToScene(initialPosition, mapping),
    capability: rotary ? 'unavailable' : 'file-only',
    unavailableReason: rotary
      ? 'A positioned restart preview is unavailable for rotary jobs.'
      : null,
    resumed:
      artifact.provenance?.schemaVersion === 2 &&
      artifact.provenance.workflow.kind === 'laser-recovery',
    positionEpoch: 0,
  };
  previews.set(artifact, plan);
  return plan;
}

function historicalPreviewPosition(
  observation: ExecutionArtifactV1['archivedControllerObservation'],
) {
  const reportInches = observation.settings?.reportInches === true;
  const initialPosition = reportedWorkPositionMm(
    { statusReport: observation.statusReport ?? null, wcoCache: observation.wco ?? null },
    reportInches,
  );
  return { initialPosition };
}
