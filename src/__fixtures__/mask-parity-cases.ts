// Randomized image-mask parity cases: an image grid, a mask contour set, and
// the two transforms that place them relative to each other. Separated from
// the parity assertions so the generator can be read (and tuned) on its own.
// Test-only helper: under src/__fixtures__ (boundary- and coverage-exempt per
// eslint.config.mjs). Pure and deterministic — the caller supplies the RNG.

import { type RasterImage, type Transform, type Vec2 } from '../core/scene';

const COORDINATE_STEP_MM = 0.5;
const SCENE_EXTENT_MM = 9;
const SCENE_HALF_EXTENT_MM = SCENE_EXTENT_MM / 2;
const MAX_GRID_EXTENT = 14;
const MAX_CONTOURS = 3;
const MAX_CONTOUR_POINTS = 8;
const MIN_BLOB_RADIUS_MM = 1;
const MAX_BLOB_RADIUS_MM = 4;
const BLOB_CENTER_SPREAD_MM = 3;
const TRANSFORM_OFFSET_SPREAD_MM = 2;
const MIRROR_PROBABILITY = 0.15;
// Weighted toward zero — the unrotated grid is both the production-dominant
// case and the one the scanline accelerates — while still covering true
// rotations and the two angles whose sine is float dust rather than zero.
const CASE_ROTATIONS_DEG = [0, 0, 0, 0, 0, 180, 360, 90, 37, -12] as const;

export type MaskCase = {
  readonly image: RasterImage;
  readonly points: ReadonlyArray<ReadonlyArray<Vec2>>;
  readonly maskTransform: Transform;
  readonly width: number;
  readonly height: number;
};

export function maskRaster(bounds: RasterImage['bounds'], transform: Transform): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds,
    transform,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    imageMaskId: 'M1',
  };
}

export function randomMaskCase(random: () => number): MaskCase {
  const width = 1 + Math.floor(random() * MAX_GRID_EXTENT);
  const height = 1 + Math.floor(random() * MAX_GRID_EXTENT);
  const contourCount = 1 + Math.floor(random() * MAX_CONTOURS);
  const points: Vec2[][] = [];
  for (let contour = 0; contour < contourCount; contour += 1) {
    // Blobs sit around the local ORIGIN, which is what the object transform
    // rotates and mirrors about: an off-origin box would swing clear of the
    // contour under a 90 or 180 degree case and test nothing.
    points.push(randomBlob(random, contour === 0 ? { x: 0, y: 0 } : randomCenter(random)));
  }
  return {
    image: maskRaster(
      {
        minX: -SCENE_HALF_EXTENT_MM,
        minY: -SCENE_HALF_EXTENT_MM,
        maxX: SCENE_HALF_EXTENT_MM,
        maxY: SCENE_HALF_EXTENT_MM,
      },
      randomTransform(random),
    ),
    points,
    maskTransform: randomTransform(random),
    width,
    height,
  };
}

function randomCenter(random: () => number): Vec2 {
  const half = BLOB_CENTER_SPREAD_MM / 2;
  return {
    x: snapped(random, BLOB_CENTER_SPREAD_MM) - half,
    y: snapped(random, BLOB_CENTER_SPREAD_MM) - half,
  };
}

// An angularly ordered blob rather than a point cloud: a cloud of 3-8 random
// vertices encloses almost nothing, and a mask parity test needs pixels on
// BOTH sides of the contour. Vertices snap to the half-millimetre grid so they
// and their horizontal edges land exactly on pixel centers, which puts the
// razor-edge comparisons (point on an edge, point on a vertex) into the suite
// instead of leaving them to chance. Overlapping blobs make even-odd holes, so
// the parity arithmetic is exercised, not just membership.
function randomBlob(random: () => number, center: Vec2): Vec2[] {
  const count = 3 + Math.floor(random() * (MAX_CONTOUR_POINTS - 2));
  const blob: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + random() * 0.8) / count) * 2 * Math.PI;
    const radius = MIN_BLOB_RADIUS_MM + random() * (MAX_BLOB_RADIUS_MM - MIN_BLOB_RADIUS_MM);
    blob.push({
      x: snapToGrid(center.x + radius * Math.cos(angle)),
      y: snapToGrid(center.y + radius * Math.sin(angle)),
    });
  }
  return blob;
}

function randomTransform(random: () => number): Transform {
  const rotationDeg = CASE_ROTATIONS_DEG[Math.floor(random() * CASE_ROTATIONS_DEG.length)] ?? 0;
  const half = TRANSFORM_OFFSET_SPREAD_MM / 2;
  return {
    x: snapped(random, TRANSFORM_OFFSET_SPREAD_MM) - half,
    y: snapped(random, TRANSFORM_OFFSET_SPREAD_MM) - half,
    scaleX: random() < MIRROR_PROBABILITY ? -1 : 1,
    scaleY: random() < MIRROR_PROBABILITY ? 2 : 1,
    rotationDeg,
    mirrorX: random() < MIRROR_PROBABILITY,
    mirrorY: random() < MIRROR_PROBABILITY,
  };
}

function snapToGrid(value: number): number {
  return Math.round(value * (1 / COORDINATE_STEP_MM)) * COORDINATE_STEP_MM;
}

function snapped(random: () => number, span: number): number {
  return snapToGrid(random() * span);
}
