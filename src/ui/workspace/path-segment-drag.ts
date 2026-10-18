// Dragging a segment with the node tool (LightBurn Edit Nodes: "click any
// straight line and drag to turn it into a curve"). The press grabs the point
// under the pointer; each move reshapes the segment from its original form so
// that point follows the pointer exactly, and the drag's interaction snapshot
// makes the whole drag one undo step. Nothing changes until the pointer leaves
// a small click slop, so a press with a little hand jitter never turns a
// straight line into a curve.

import {
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type Transform,
  type Vec2,
} from '../../core/scene';
import type { PathSegmentRef } from '../state/path-segment-actions';
import { hitPathSegment } from './path-segment-hit-test';

// Canvas pixels the pointer may wander before a press becomes a reshape; the
// same slop the laser tab editor gives a click.
export const SEGMENT_DRAG_SLOP_PX = 3;

// Drags whose pointer has left the slop: from then on every move reshapes.
const movedDrags = new WeakSet<PathSegmentDragState>();

export type PathSegmentDragState = {
  readonly kind: 'path-segment';
  readonly segment: PathSegmentRef;
  readonly original: CurveSubpath;
  readonly transform: Transform;
  readonly startScenePoint: Vec2;
  /** The click slop in scene millimetres at the zoom the press happened at. */
  readonly slopMm: number;
};

export function beginPathSegmentDrag(
  project: Project,
  scenePoint: Vec2,
  pxToMm: number,
): PathSegmentDragState | null {
  const hit = hitPathSegment(project.scene, scenePoint, pxToMm);
  if (hit === null) return null;
  const object = project.scene.objects.find((candidate) => candidate.id === hit.objectId);
  if (object === undefined || !('paths' in object)) return null;
  const original = hitCurve(object.paths[hit.pathIndex], hit.curveIndex);
  const kind = original?.segments[hit.segmentIndex]?.kind;
  if (original === null || kind === undefined || kind === 'elliptical-arc') return null;
  const { point: _point, ...ref } = hit;
  return {
    kind: 'path-segment',
    segment: ref,
    original,
    transform: object.transform,
    startScenePoint: scenePoint,
    slopMm: SEGMENT_DRAG_SLOP_PX * pxToMm,
  };
}

function hitCurve(path: ColoredPath | undefined, index: number): CurveSubpath | null {
  if (path === undefined) return null;
  if (path.curves !== undefined) return path.curves[index] ?? null;
  const polyline = path.polylines[index];
  return polyline === undefined ? null : polylineToCurveSubpath(polyline);
}

export function updatePathSegmentDrag(
  drag: PathSegmentDragState,
  point: Vec2 | null,
  reshape: (ref: PathSegmentRef, original: CurveSubpath, localDelta: Vec2) => void,
): void {
  if (point === null) return;
  const moved = Math.hypot(point.x - drag.startScenePoint.x, point.y - drag.startScenePoint.y);
  if (moved > drag.slopMm) movedDrags.add(drag);
  if (!movedDrags.has(drag)) return;
  const delta = sceneVectorToLocal(
    { x: point.x - drag.startScenePoint.x, y: point.y - drag.startScenePoint.y },
    drag.transform,
  );
  if (delta !== null) reshape(drag.segment, drag.original, delta);
}

// Inverse of applyTransform's linear part: rotate back, unmirror, unscale.
function sceneVectorToLocal(vector: Vec2, transform: Transform): Vec2 | null {
  if (transform.scaleX === 0 || transform.scaleY === 0) return null;
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let x = vector.x * cos + vector.y * sin;
  let y = -vector.x * sin + vector.y * cos;
  if (transform.mirrorX) x = -x;
  if (transform.mirrorY) y = -y;
  return { x: x / transform.scaleX, y: y / transform.scaleY };
}
