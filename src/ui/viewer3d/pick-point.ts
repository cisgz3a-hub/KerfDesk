// The retained part of a picked move supplies its point and measurement snap.
// Section and Z clipping may leave the original endpoint hidden (ADR-470).
import type * as ThreeNamespace from 'three';
import { nearestEnd } from './pick-ids';
import type { PickPointer, Viewer3dPick } from './scene-pick';
import type { ViewCamera } from './scene-setup';

type ThreeModule = typeof ThreeNamespace;
type ClipPlanes = readonly ThreeNamespace.Plane[] | null;

/** Closest point on the visible interval; only original, visible ends snap. */
export function closestVisibleOnMove(
  three: ThreeModule,
  camera: ViewCamera,
  pointer: PickPointer,
  positions: Float32Array,
  segmentIndex: number,
  planes: ClipPlanes,
): Viewer3dPick | null {
  const start = new three.Vector3().fromArray(positions, segmentIndex * 6);
  const end = new three.Vector3().fromArray(positions, segmentIndex * 6 + 3);
  const interval = retainedInterval(start, end, planes);
  if (interval === null) return null;
  const ndc = new three.Vector2(
    (pointer.xPx / Math.max(1, pointer.widthPx)) * 2 - 1,
    1 - (pointer.yPx / Math.max(1, pointer.heightPx)) * 2,
  );
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  // This rig can put the orthographic near plane behind the camera.
  if ('isOrthographicCamera' in camera) {
    raycaster.ray.origin.set(ndc.x, ndc.y, -1).unproject(camera);
  }
  const onMove = new three.Vector3();
  raycaster.ray.distanceSqToSegment(
    start.clone().lerp(end, interval[0]),
    start.clone().lerp(end, interval[1]),
    undefined,
    onMove,
  );
  const length = start.distanceTo(end);
  const fraction = length > 0 ? Math.min(1, Math.max(0, start.distanceTo(onMove) / length)) : 1;
  const snap = nearestEnd(
    { x: pointer.xPx, y: pointer.yPx },
    interval[0] === 0 ? onScreen(start, camera, pointer) : null,
    interval[1] === 1 ? onScreen(end, camera, pointer) : null,
  );
  const vertex = snap === null ? null : snap === 'start' ? start : end;
  return {
    segmentIndex,
    fraction,
    point: { x: onMove.x, y: onMove.y, z: onMove.z },
    vertex: vertex === null ? null : { x: vertex.x, y: vertex.y, z: vertex.z },
  };
}

// Intersect the move's parameter interval with every retained half-space.
// The same plane signs and inclusive boundaries are used by the GPU pass.
function retainedInterval(
  start: ThreeNamespace.Vector3,
  end: ThreeNamespace.Vector3,
  planes: ClipPlanes,
): readonly [number, number] | null {
  let first = 0;
  let last = 1;
  for (const plane of planes ?? []) {
    const from = plane.distanceToPoint(start);
    const to = plane.distanceToPoint(end);
    if (from < 0 && to < 0) return null;
    if (from < 0) first = Math.max(first, from / (from - to));
    else if (to < 0) last = Math.min(last, from / (from - to));
    if (first > last) return null;
  }
  return [first, last];
}

function onScreen(
  point: ThreeNamespace.Vector3,
  camera: ViewCamera,
  pointer: PickPointer,
): { x: number; y: number } | null {
  const projected = point.clone().project(camera);
  if (
    !Number.isFinite(projected.x + projected.y + projected.z) ||
    Math.abs(projected.x) > 1 ||
    Math.abs(projected.y) > 1 ||
    Math.abs(projected.z) > 1
  )
    return null;
  return {
    x: ((projected.x + 1) / 2) * pointer.widthPx,
    y: ((1 - projected.y) / 2) * pointer.heightPx,
  };
}
