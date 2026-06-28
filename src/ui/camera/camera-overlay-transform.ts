import { homographyToMatrix3d, multiplyMat3, type Mat3, type Matrix3d } from '../../core/camera';
import type { ViewTransform } from '../workspace/view-transform';

/**
 * Compose the camera→bed homography with the workspace view transform (and the
 * canvas bitmap→CSS-pixel scale) into the CSS `matrix3d` that warps the live
 * `<video>` so it registers on the rendered bed:
 *
 *   camera pixel --H--> bed mm --view--> canvas-bitmap px --cssScale--> CSS px
 *
 * The view maps bed mm to canvas pixels as `px = offset + mm·scale` (no y-flip;
 * the scene renders bed-y downward, matching the canvas). `cssScale` bridges
 * the canvas bitmap resolution to its laid-out CSS size.
 */
export function overlayMatrix3d(homography: Mat3, view: ViewTransform, cssScale = 1): Matrix3d {
  const scale = view.scale * cssScale;
  const viewMat: Mat3 = [
    scale,
    0,
    view.offsetX * cssScale,
    0,
    scale,
    view.offsetY * cssScale,
    0,
    0,
    1,
  ];
  return homographyToMatrix3d(multiplyMat3(viewMat, homography));
}
