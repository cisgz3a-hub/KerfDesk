// Standard viewing directions (ADR-255 stage 10; ADR-426).
//
// Pure geometry: given the job's bounds, where does the camera sit? Kept out
// of the scene so the framing maths is unit-tested without WebGL.
//
// Top / Front / Right are the drawing views a CAD operator expects; Iso is
// the default three-quarter view. The view cube adds the three opposite faces.
// The frame is Z-up work coordinates, and up stays +Z in every view: orbit
// controls fix their orbit axis from the camera's up when they are created,
// so a view that changed it would leave the next orbit rolling (ADR-426).

import type { AxisBounds } from '../../core/gcode-view';

/** The views with their own button, in button order. */
export const CAMERA_PRESETS = ['iso', 'top', 'front', 'right'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

/** Every named view: the buttons plus the view cube's other three faces. */
export const VIEWER3D_VIEWS = ['iso', 'top', 'front', 'right', 'bottom', 'back', 'left'] as const;
export type Viewer3dView = (typeof VIEWER3D_VIEWS)[number];

export type Viewer3dProjection = 'perspective' | 'orthographic';

export const CAMERA_PRESET_LABEL: Readonly<Record<CameraPreset, string>> = {
  iso: 'Iso',
  top: 'Top',
  front: 'Front',
  right: 'Right',
};

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export type CameraPlacement = {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
};

/** Vertical field of view of every Inspector camera, in degrees. */
export const VIEWER3D_FOV_DEG = 40;
const DEFAULT_VIEW_MM = 100;
const MIN_EXTENT_MM = 10;
// Room around the job's projected outline, so the outer moves are not drawn
// against the viewport edge.
const FIT_MARGIN = 1.08;
// Plan views lean a hair toward -Y so +Y reads up the screen with +Z up.
const PLAN_LEAN = 0.0008;
const Z_UP: Vec3 = { x: 0, y: 0, z: 1 };
const X_AXIS: Vec3 = { x: 1, y: 0, z: 0 };

// Unit-ish offsets from the target toward the camera, in the Z-up work frame.
const DIRECTIONS: Readonly<Record<Viewer3dView, Vec3>> = {
  // Front-right-above: matches the scene's opening view.
  iso: { x: 0.6, y: -0.6, z: 0.55 },
  top: { x: 0, y: -PLAN_LEAN, z: 1 },
  bottom: { x: 0, y: -PLAN_LEAN, z: -1 },
  front: { x: 0, y: -1, z: 0 },
  back: { x: 0, y: 1, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
};

/** Iso is a perspective view; every face of the cube is a drawing view. */
export function projectionForView(view: Viewer3dView): Viewer3dProjection {
  return view === 'iso' ? 'perspective' : 'orthographic';
}

/** The unit direction from the target toward the camera for a named view. */
export function viewDirection(view: Viewer3dView): Vec3 {
  return unit(DIRECTIONS[view]);
}

export function cameraPlacement(
  view: Viewer3dView,
  bounds: AxisBounds | null,
  aspect = 1,
  projection: Viewer3dProjection = 'perspective',
): CameraPlacement {
  return placementAlong(viewDirection(view), bounds, aspect, projection);
}

/** Frames the job from a given direction (unit, target toward camera). */
export function placementAlong(
  direction: Vec3,
  bounds: AxisBounds | null,
  aspect: number,
  projection: Viewer3dProjection,
): CameraPlacement {
  const target = boundsCenter(bounds);
  const distance = fitDistance(direction, bounds, aspect, projection);
  return {
    position: {
      x: target.x + direction.x * distance,
      y: target.y + direction.y * distance,
      z: target.z + direction.z * distance,
    },
    target,
    up: Z_UP,
  };
}

/**
 * How far from the job's centre the camera sits so every corner of the job's
 * box is inside the view. Fits the box as it projects, not a sphere around
 * it, so a flat sheet seen from above fills the view (ADR-426). An
 * orthographic view shows `distance x tan(fov / 2)` either side of the target,
 * so the same number frames both projections.
 */
export function fitDistance(
  direction: Vec3,
  bounds: AxisBounds | null,
  aspect: number,
  projection: Viewer3dProjection,
): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const tanY = Math.tan((VIEWER3D_FOV_DEG * Math.PI) / 360);
  const tanX = tanY * safeAspect;
  const basis = viewBasis(direction);
  // A job seen end-on (a straight line down its own length, a drilled hole
  // from above) projects to a point. Its view still shows the minimum extent,
  // so the camera never sits on the target, where the orbit has no direction.
  const minReach = ((MIN_EXTENT_MM / 2) * FIT_MARGIN) / Math.min(tanX, tanY);
  let distance = 0;
  for (const corner of boxCorners(bounds)) {
    const across = Math.abs(dot(corner, basis.right)) * FIT_MARGIN;
    const upward = Math.abs(dot(corner, basis.up)) * FIT_MARGIN;
    const reach = Math.max(across / tanX, upward / tanY, minReach);
    distance = Math.max(
      distance,
      projection === 'orthographic' ? reach : reach + dot(corner, direction),
    );
  }
  return distance;
}

/** Screen right and up for a camera looking back along `direction` with +Z up. */
export function viewBasis(direction: Vec3): { readonly right: Vec3; readonly up: Vec3 } {
  const across = cross(Z_UP, direction);
  // Straight down the Z axis the cross product vanishes; +X is then right.
  const right = Math.hypot(across.x, across.y, across.z) > 1e-9 ? unit(across) : X_AXIS;
  return { right, up: unit(cross(direction, right)) };
}

export function boundsCenter(bounds: AxisBounds | null): Vec3 {
  if (bounds === null) return { x: 0, y: 0, z: 0 };
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

export function boundsExtent(bounds: AxisBounds | null): number {
  if (bounds === null) return DEFAULT_VIEW_MM;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ - bounds.minZ;
  return Math.max(spanX, spanY, spanZ, MIN_EXTENT_MM);
}

// The job box's corners relative to its centre. A job smaller than the
// minimum extent frames as a cube of that size, so a single point or a tiny
// mark never pulls the camera onto it.
function boxCorners(bounds: AxisBounds | null): ReadonlyArray<Vec3> {
  const half = halfSpans(bounds);
  const corners: Vec3[] = [];
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) corners.push({ x, y, z });
    }
  }
  return corners;
}

function halfSpans(bounds: AxisBounds | null): Vec3 {
  if (bounds === null || boundsExtent(bounds) <= MIN_EXTENT_MM) {
    const half = (bounds === null ? DEFAULT_VIEW_MM : MIN_EXTENT_MM) / 2;
    return { x: half, y: half, z: half };
  }
  return {
    x: (bounds.maxX - bounds.minX) / 2,
    y: (bounds.maxY - bounds.minY) / 2,
    z: (bounds.maxZ - bounds.minZ) / 2,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 0 ? { x: v.x / length, y: v.y / length, z: v.z / length } : Z_UP;
}
