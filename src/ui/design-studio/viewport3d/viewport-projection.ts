import type * as Three from 'three';
import type { Vec2 } from '../../../core/scene';
import { localFromScene } from '../../cnc-viewer3d/viewer3d-picking';
import type { ViewportFrame } from './viewport-scene';
import { OVERLAY_LIFT_MM } from './viewport-overlay';

/** Projects sketch endpoints at their rendered elevation into canvas CSS pixels. */
export function projectSketchToViewport(
  three: Pick<typeof Three, 'Vector3'>,
  camera: Three.Camera,
  point: Vec2,
  frame: ViewportFrame,
  width: number,
  height: number,
): Vec2 | null {
  if (width <= 0 || height <= 0) return null;
  const local = localFromScene({ ...point, z: OVERLAY_LIFT_MM }, frame.originMm, frame);
  const ndc = new three.Vector3(local.x, local.y, local.z).project(camera);
  if (![ndc.x, ndc.y, ndc.z].every(Number.isFinite) || ndc.z < -1 || ndc.z > 1) return null;
  return { x: ((ndc.x + 1) * width) / 2, y: ((1 - ndc.y) * height) / 2 };
}
