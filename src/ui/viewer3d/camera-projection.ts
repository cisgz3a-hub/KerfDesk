// Orthographic views (ADR-426). Plan views drawn in perspective show
// parallax: a drilled hole reads as a slanted stroke from above. Top, Front,
// Right and the cube faces therefore draw orthographically.
//
// The orbit controls always drive the perspective camera; the orthographic
// camera copies its pose each frame and shows `distance x tan(fov / 2)`
// either side of the target. So both projections frame the target plane at
// the same size, switching between them never jumps, and follow mode, view
// animations and zoom work the same way in both.

import type { OrthographicCamera, PerspectiveCamera } from 'three';

/** Half the height an orthographic view shows at a given camera distance. */
export function orthographicHalfHeight(distance: number, fovDeg: number): number {
  return distance * Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Copies the perspective camera's pose into the orthographic camera and sizes
 * its frustum to the same target plane.
 *
 * @param distance Camera-to-target distance of the perspective camera.
 * @param depthMm Half the depth range kept; the near plane sits behind the
 *   camera so nothing between it and the job is clipped.
 */
export function syncOrthographicCamera(
  ortho: OrthographicCamera,
  perspective: PerspectiveCamera,
  distance: number,
  depthMm: number,
): void {
  const half = orthographicHalfHeight(distance, perspective.fov);
  ortho.position.copy(perspective.position);
  ortho.quaternion.copy(perspective.quaternion);
  ortho.up.copy(perspective.up);
  ortho.top = half;
  ortho.bottom = -half;
  ortho.right = half * perspective.aspect;
  ortho.left = -ortho.right;
  ortho.near = -depthMm;
  ortho.far = depthMm;
  ortho.zoom = 1;
  ortho.updateProjectionMatrix();
  ortho.updateMatrixWorld();
}
