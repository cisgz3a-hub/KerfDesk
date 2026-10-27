// "Add target to canvas" (ADR-441 Amendment 5) leaves the rings for the
// operator to Frame and Start like any job, maybe after Machine Setup has
// changed or the machine was homed. A calibration records the bed frame its
// rings were placed in, which for these rings is the frame at the Start that
// streams them, so it is taken there (ADR-440 Amendment 5, rolling audit v3
// G6-P2-1). The Start is recognised by its scene: every ring of the
// remembered layout, unmoved, burned at Absolute Coordinates.

import { DEFAULT_RING_DIAMETER_MM } from '../../../core/camera/target/bed-target';
import { generateCameraBedTarget } from '../../../core/job/camera-bed-target-pattern';
import { filterSceneForOutputScope, type Scene, type Transform } from '../../../core/scene';
import type { FramedRunCandidate } from '../../state/framed-run';
import { useLaserStore } from '../../state/laser-store';
import { cameraBedFrameFor, type NativeBedEvidence } from '../../state/native-bed-frame';
import {
  rememberEngravedTarget,
  rememberedEngravedTarget,
  type EngravedTarget,
} from './engraved-target-memory';

/** Takes the canvas target's bed frame at each framed Start that streams its rings. */
export function watchCanvasTargetBurns(): () => void {
  return useLaserStore.subscribe((state, previous) => {
    const owner = state.completedFrameRunOwner ?? null;
    if (owner === null || owner === (previous.completedFrameRunOwner ?? null)) return;
    stampCanvasTargetBurn(owner.frame.candidate, state);
  });
}

/** What a framed Start streamed: the job, its output scope and its Start from. */
export type StartedJob = Pick<FramedRunCandidate, 'project' | 'outputScope'> & {
  readonly preparedStart: Pick<FramedRunCandidate['preparedStart'], 'jobOrigin'>;
};

/**
 * When `started` streams the rings of a target put on the canvas, at Absolute
 * Coordinates, remember the bed frame of that Start as the target's. True
 * when a remembered target was stamped.
 */
export function stampCanvasTargetBurn(
  started: StartedJob,
  evidence: NativeBedEvidence,
  now: Date = new Date(),
): boolean {
  // Only Absolute Coordinates burn the rings where the target put them.
  const startFrom = started.preparedStart.jobOrigin?.startFrom ?? 'absolute';
  if (startFrom !== 'absolute') return false;
  const { device } = started.project;
  const scene = filterSceneForOutputScope(started.project.scene, started.outputScope);
  let stamped = false;
  for (const headCamera of [false, true]) {
    const target = rememberedEngravedTarget(device, headCamera);
    if (target?.onCanvas !== true || !streamsRings(scene, target)) continue;
    rememberEngravedTarget(device, headCamera, {
      ...target,
      bedFrame: cameraBedFrameFor(device, evidence),
      engravedAt: now.toISOString(),
      burnSeen: true,
    });
    stamped = true;
  }
  return stamped;
}

// Every ring of the target's layout is in the job, where the target put it.
function streamsRings(scene: Scene, target: EngravedTarget): boolean {
  const rings = generateCameraBedTarget({
    area: target.area,
    ringDiameterMm: target.ringDiameterMm ?? DEFAULT_RING_DIAMETER_MM,
  }).objects;
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  return rings.every((ring) => {
    const object = byId.get(ring.id);
    return object !== undefined && sameTransform(object.transform, ring.transform);
  });
}

const SAME_MM = 1e-6;

function sameTransform(a: Transform, b: Transform): boolean {
  return (
    Math.abs(a.x - b.x) < SAME_MM &&
    Math.abs(a.y - b.y) < SAME_MM &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.rotationDeg === b.rotationDeg &&
    a.mirrorX === b.mirrorX &&
    a.mirrorY === b.mirrorY
  );
}
