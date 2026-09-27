// The one geometric camera model every camera feature shares (ADR-440): a
// Kannala-Brandt lens (pinhole intrinsics plus a four-term angular distortion
// polynomial, which covers normal webcams and 160° fisheyes alike) and a rigid
// pose that places the camera in machine bed coordinates.
//
// World frame: bed millimetres exactly as the workspace uses them (x right,
// y down as seen from above), with z pointing DOWN into the bed so the frame
// stays right-handed. A surface h mm above the bed therefore sits at z = -h.
// Because the model is a real 3D ray map, any surface height is exact: there
// is no separate "rectified basis", homography, or height fudge to keep in
// step, which is where the old camera stack kept going wrong.

import { distortFisheye, undistortPixel, type CameraIntrinsics } from '../fisheye';
import type { FisheyeDistortion } from '../fisheye';
import type { Mat3 } from '../homography';
import { rodriguesToMatrix, type Rvec } from '../rodrigues';

export type Vec2 = { readonly x: number; readonly y: number };
export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export type LensModel = {
  readonly intrinsics: CameraIntrinsics;
  readonly distortion: FisheyeDistortion;
  /** Pixel size of the frames the intrinsics are expressed in. */
  readonly imageWidth: number;
  readonly imageHeight: number;
};

/** World → camera rigid transform: Xc = R(rvec)·Xw + tvec, millimetres. */
export type CameraPose = {
  readonly rvec: Rvec;
  readonly tvec: readonly [number, number, number];
};

// Rays this close to (or behind) the image plane do not project.
const MIN_DEPTH = 1e-6;

/** A bed point `heightMm` above the bed surface, in the model's world frame. */
export function bedPoint(x: number, y: number, heightMm = 0): Vec3 {
  return { x, y, z: -heightMm };
}

export function worldToCamera(pose: CameraPose, p: Vec3, rotation?: Mat3): Vec3 {
  const r = rotation ?? rodriguesToMatrix(pose.rvec);
  return {
    x: r[0] * p.x + r[1] * p.y + r[2] * p.z + pose.tvec[0],
    y: r[3] * p.x + r[4] * p.y + r[5] * p.z + pose.tvec[1],
    z: r[6] * p.x + r[7] * p.y + r[8] * p.z + pose.tvec[2],
  };
}

/** Pixel of a camera-frame point, or null when it lies behind the camera. */
export function projectCameraPoint(lens: LensModel, c: Vec3): Vec2 | null {
  if (!(c.z > MIN_DEPTH)) return null;
  const d = distortFisheye(c.x / c.z, c.y / c.z, lens.distortion);
  const k = lens.intrinsics;
  return { x: k.fx * d.x + k.cx, y: k.fy * d.y + k.cy };
}

/** Pixel where the camera sees world point `p`, or null when it is behind the camera. */
export function projectWorldPoint(
  lens: LensModel,
  pose: CameraPose,
  p: Vec3,
  rotation?: Mat3,
): Vec2 | null {
  return projectCameraPoint(lens, worldToCamera(pose, p, rotation));
}

/** Camera centre in world coordinates: C = -Rᵀ·t. */
export function cameraCentre(pose: CameraPose): Vec3 {
  const r = rodriguesToMatrix(pose.rvec);
  const [tx, ty, tz] = pose.tvec;
  return {
    x: -(r[0] * tx + r[3] * ty + r[6] * tz),
    y: -(r[1] * tx + r[4] * ty + r[7] * tz),
    z: -(r[2] * tx + r[5] * ty + r[8] * tz),
  };
}

/**
 * The bed (x, y) the camera sees at `pixel` on the surface `heightMm` above the
 * bed: back-project the pixel to a ray and intersect it with that plane. Null
 * when the ray runs parallel to or away from the plane.
 */
export function pixelToBed(
  lens: LensModel,
  pose: CameraPose,
  pixel: Vec2,
  heightMm = 0,
): Vec2 | null {
  return bedMapper(lens, pose)(pixel, heightMm);
}

/** {@link pixelToBed} with the pose's rotation and centre worked out once, for per-pixel use. */
export function bedMapper(
  lens: LensModel,
  pose: CameraPose,
): (pixel: Vec2, heightMm?: number) => Vec2 | null {
  const r = rodriguesToMatrix(pose.rvec);
  const centre = cameraCentre(pose);
  return (pixel, heightMm = 0) => {
    const ray = undistortPixel(pixel.x, pixel.y, lens.intrinsics, lens.distortion);
    // Ray direction in world = Rᵀ·(a, b, 1); origin = camera centre.
    const dx = r[0] * ray.x + r[3] * ray.y + r[6];
    const dy = r[1] * ray.x + r[4] * ray.y + r[7];
    const dz = r[2] * ray.x + r[5] * ray.y + r[8];
    if (Math.abs(dz) < MIN_DEPTH) return null;
    const s = (-heightMm - centre.z) / dz;
    if (!(s > 0)) return null;
    return { x: centre.x + s * dx, y: centre.y + s * dy };
  };
}

/**
 * Rescale a lens to frames of another size with the same aspect (a pure
 * resize). Pixel centres sit at integer coordinates, so the principal point
 * scales about the frame's outer edge, not about pixel 0's centre.
 */
export function scaleLens(lens: LensModel, width: number, height: number): LensModel {
  const sx = width / lens.imageWidth;
  const sy = height / lens.imageHeight;
  const k = lens.intrinsics;
  return {
    ...lens,
    intrinsics: {
      fx: k.fx * sx,
      fy: k.fy * sy,
      cx: (k.cx + 0.5) * sx - 0.5,
      cy: (k.cy + 0.5) * sy - 0.5,
    },
    imageWidth: width,
    imageHeight: height,
  };
}
