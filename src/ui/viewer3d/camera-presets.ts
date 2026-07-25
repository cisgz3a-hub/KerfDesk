// Standard viewing directions (ADR-255 stage 10).
//
// Pure geometry: given the job's bounds, where does the camera sit and which
// way is up? Kept out of the scene so the framing maths is unit-tested
// without WebGL.
//
// Top / Front / Right are the drawing views a CAD operator expects; Iso is
// the default three-quarter view. The frame is Z-up work coordinates.

import type { AxisBounds } from '../../core/gcode-view';

export const CAMERA_PRESETS = ['iso', 'top', 'front', 'right'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

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
  /** Up vector — Top looks straight down, so its up is +Y, not +Z. */
  readonly up: Vec3;
};

const FIT_DISTANCE_FACTOR = 1.7;
const DEFAULT_VIEW_MM = 100;
const MIN_EXTENT_MM = 10;

// Unit offsets from the target for each view, in the Z-up work frame.
const DIRECTIONS: Readonly<Record<CameraPreset, Vec3>> = {
  // Front-right-above: matches the scene's opening view.
  iso: { x: 0.6, y: -0.6, z: 0.55 },
  top: { x: 0, y: 0, z: 1 },
  front: { x: 0, y: -1, z: 0 },
  right: { x: 1, y: 0, z: 0 },
};

const UPS: Readonly<Record<CameraPreset, Vec3>> = {
  iso: { x: 0, y: 0, z: 1 },
  // Looking straight down the Z axis, +Z as up is degenerate: use +Y so the
  // job reads the same way round as the design canvas.
  top: { x: 0, y: 1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  right: { x: 0, y: 0, z: 1 },
};

export function cameraPlacement(preset: CameraPreset, bounds: AxisBounds | null): CameraPlacement {
  const target = boundsCenter(bounds);
  const distance = boundsExtent(bounds) * FIT_DISTANCE_FACTOR;
  const direction = DIRECTIONS[preset];
  return {
    position: {
      x: target.x + direction.x * distance,
      y: target.y + direction.y * distance,
      z: target.z + direction.z * distance,
    },
    target,
    up: UPS[preset],
  };
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
