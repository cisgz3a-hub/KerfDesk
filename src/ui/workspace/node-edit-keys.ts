// LightBurn's Edit Nodes hover keys for the workspace node tool. Each acts on
// the node or the segment under the pointer, not on a selection made first:
//   D delete node or segment    I insert node     M insert node at midpoint
//   C corner node               S smooth node, or line segment to curve
//   L segment to line           B break at node   A align selection to segment
//   T trim segment              E extend open end
// Returns whether the key was handled, so the caller can keep it from the
// workspace's ordinary shortcuts (T is otherwise the Text tool).

import { curveSegmentPoint } from '../../core/geometry/curve-segment-edit';
import {
  applyTransform,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Scene,
  type Vec2,
} from '../../core/scene';
import type { useStore } from '../state';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { hitPathNode } from './path-node-hit-test';
import { hitPathSegment, type PathSegmentHit } from './path-segment-hit-test';

type App = ReturnType<typeof useStore.getState>;

export const NODE_EDIT_KEYS = new Set(['d', 'i', 'm', 'c', 's', 'l', 'b', 'a', 't', 'e']);

const ALIGN_STEP_DEG = 45;
const TANGENT_DT = 1e-4;

export function handleNodeEditKey(app: App, key: string, cursor: Vec2, pxToMm: number): boolean {
  if (!NODE_EDIT_KEYS.has(key)) return false;
  const scene = app.project.scene;
  // Like a Trim tool click without Ctrl (the hover keys never fire with Ctrl): auto-join.
  if (key === 't') return app.trimShapeAt(cursor, 8 * pxToMm, { autoJoin: true });
  if (key === 'e') return app.extendShapeAt(cursor, 8 * pxToMm);
  const hovered = hitPathNode(scene, cursor, pxToMm, app.selectedPathNodes);
  const node = hovered?.handle === undefined ? hovered : null;
  if (node !== null) return nodeKey(app, key, node);
  const segment = hitPathSegment(scene, cursor, pxToMm);
  return segment === null ? false : segmentKey(app, key, segment);
}

function nodeKey(app: App, key: string, node: PathNodeRef): boolean {
  const inSelection = app.selectedPathNodes.some(
    (ref) =>
      ref.objectId === node.objectId &&
      ref.pathIndex === node.pathIndex &&
      ref.polylineIndex === node.polylineIndex &&
      ref.pointIndex === node.pointIndex,
  );
  const select = (): void => {
    if (!inSelection || key !== 'd') app.selectPathNode(node);
  };
  switch (key) {
    case 'd':
      select();
      app.deleteSelectedPathNodes();
      return true;
    case 'c':
      select();
      app.cornerSelectedCurveNode();
      return true;
    case 's':
      select();
      app.smoothSelectedCurveNode();
      return true;
    case 'b':
      select();
      app.breakSelectedCurve();
      return true;
    default:
      return false;
  }
}

function segmentKey(app: App, key: string, segment: PathSegmentHit): boolean {
  switch (key) {
    case 'd':
      app.deletePathSegment(segment);
      return true;
    case 'i':
      app.insertPathNode(segment, 'point');
      return true;
    case 'm':
      app.insertPathNode(segment, 'midpoint');
      return true;
    case 's':
    case 'l':
      app.selectPathNode(segmentStartNode(app.project.scene, segment));
      app.convertSelectedCurveSegment(key === 'l' ? 'line' : 'cubic');
      return true;
    case 'a':
      return alignSelectionToSegment(app, segment);
    default:
      return false;
  }
}

/** Turns the selection so the segment under the pointer lies on the nearest 45° direction. */
function alignSelectionToSegment(app: App, segment: PathSegmentHit): boolean {
  const angle = segmentAngleDeg(app.project.scene, segment);
  if (angle === null) return false;
  const target = Math.round(angle / ALIGN_STEP_DEG) * ALIGN_STEP_DEG;
  const delta = target - angle;
  if (Math.abs(delta) < 1e-9) return true;
  if (app.selectedObjectId === null) app.selectObject(segment.objectId);
  app.rotateSelectionBy(delta);
  return true;
}

export function segmentAngleDeg(scene: Scene, segment: PathSegmentHit): number | null {
  const object = scene.objects.find((candidate) => candidate.id === segment.objectId);
  if (object === undefined || !('paths' in object)) return null;
  const curve = pathCurve(object.paths[segment.pathIndex], segment.curveIndex);
  if (curve === null) return null;
  const t0 = Math.max(0, segment.t - TANGENT_DT);
  const t1 = Math.min(1, segment.t + TANGENT_DT);
  const a = curveSegmentPoint(curve, segment.segmentIndex, t0);
  const b = curveSegmentPoint(curve, segment.segmentIndex, t1);
  if (a === null || b === null) return null;
  const wa = applyTransform(a, object.transform);
  const wb = applyTransform(b, object.transform);
  if (Math.hypot(wb.x - wa.x, wb.y - wa.y) === 0) return null;
  return (Math.atan2(wb.y - wa.y, wb.x - wa.x) * 180) / Math.PI;
}

function segmentStartNode(scene: Scene, segment: PathSegmentHit): PathNodeRef {
  const object = scene.objects.find((candidate) => candidate.id === segment.objectId);
  const path =
    object !== undefined && 'paths' in object ? object.paths[segment.pathIndex] : undefined;
  return {
    objectId: segment.objectId,
    pathIndex: segment.pathIndex,
    polylineIndex: segment.curveIndex,
    pointIndex: segment.segmentIndex,
    ...(path?.curves === undefined ? {} : { geometry: 'curve' as const }),
  };
}

function pathCurve(path: ColoredPath | undefined, index: number): CurveSubpath | null {
  if (path === undefined) return null;
  if (path.curves !== undefined) return path.curves[index] ?? null;
  const polyline = path.polylines[index];
  return polyline === undefined ? null : polylineToCurveSubpath(polyline);
}
