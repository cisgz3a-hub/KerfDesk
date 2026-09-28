// A camera on the laser head (ADR-449). It travels with the head, so its pose
// is the calibrated pose moved by how far the head has gone since the
// calibration photo, and it keeps its turn and height. Everything else is the
// fixed-camera model of ADR-440 unchanged: each pixel is a ray, and a bed
// point is where that ray meets the material. The camera sees a small patch
// of the bed at a time; a capture plan moves the head so the patches cover an
// area, and the pictures are stitched into one top-down picture of it
// (head-camera-stitch.ts). Pure core.

import { rodriguesToMatrix } from '../rodrigues';
import type { BedArea, CameraModelAccuracy } from './camera-model-accuracy';
import { bedMapper, type CameraPose, type Vec2 } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';

// Only the middle of a head camera's picture is used for stitching: the edges
// of a close-up lens are the least sharp and the least accurate.
export const HEAD_CAMERA_USABLE_FRACTION = 0.8;
// Neighbouring pictures share this much of their width, so the seams blend.
export const HEAD_CAPTURE_OVERLAP = 0.2;

export function isHeadCameraModel(record: CameraModelRecord | undefined): boolean {
  return record?.mount?.kind === 'head';
}

/** `pose` for the camera moved `shiftMm` across the bed, without turning. */
export function shiftedPose(pose: CameraPose, shiftMm: Vec2): CameraPose {
  // world→camera is x_c = R·x_w + t; moving the camera by d gives R·(x_w − d) + t.
  const r = rodriguesToMatrix(pose.rvec);
  const [tx, ty, tz] = pose.tvec;
  return {
    rvec: pose.rvec,
    tvec: [
      tx - (r[0] * shiftMm.x + r[1] * shiftMm.y),
      ty - (r[3] * shiftMm.x + r[4] * shiftMm.y),
      tz - (r[6] * shiftMm.x + r[7] * shiftMm.y),
    ],
  };
}

/**
 * The model as a head camera sees the bed with the head at `headMm`: its pose,
 * and its measured rings, moved with the head. A fixed camera's model is
 * returned as it is.
 */
export function modelAtHead(record: CameraModelRecord, headMm: Vec2): CameraModelRecord {
  const mount = record.mount;
  if (mount?.kind !== 'head') return record;
  const shift = {
    x: headMm.x - mount.headAtCalibrationMm.x,
    y: headMm.y - mount.headAtCalibrationMm.y,
  };
  if (shift.x === 0 && shift.y === 0) return record;
  return {
    ...record,
    pose: shiftedPose(record.pose, shift),
    accuracy: shiftedAccuracy(record.accuracy, shift),
    mount: { kind: 'head', headAtCalibrationMm: { x: headMm.x, y: headMm.y } },
  };
}

function shiftedAccuracy(accuracy: CameraModelAccuracy, shift: Vec2): CameraModelAccuracy {
  const { targetArea, marks } = accuracy;
  return {
    ...accuracy,
    ...(targetArea === undefined
      ? {}
      : { targetArea: { ...targetArea, x: targetArea.x + shift.x, y: targetArea.y + shift.y } }),
    ...(marks === undefined
      ? {}
      : { marks: marks.map((mark) => ({ ...mark, x: mark.x + shift.x, y: mark.y + shift.y })) }),
  };
}

// Samples along each edge of the used picture when finding what it covers.
const EDGE_SAMPLES = 12;
const FIT_STEPS = 30;

/**
 * The bed box a head camera sees clearly at `surfaceHeightMm`, relative to the
 * head: the box's corner is at head + (x, y). It is the largest box, upright
 * on the bed, inside the middle `usableFraction` of the picture. Null when
 * part of that picture does not look at the surface.
 */
export function headCameraView(
  record: CameraModelRecord,
  surfaceHeightMm: number,
  usableFraction = HEAD_CAMERA_USABLE_FRACTION,
): BedArea | null {
  const head = record.mount?.headAtCalibrationMm ?? { x: 0, y: 0 };
  const outline = pictureOutlineOnBed(record, surfaceHeightMm, usableFraction);
  if (outline === null) return null;
  const box = largestUprightBox(outline);
  if (box === null) return null;
  return { ...box, x: box.x - head.x, y: box.y - head.y };
}

function pictureOutlineOnBed(
  record: CameraModelRecord,
  surfaceHeightMm: number,
  usableFraction: number,
): Vec2[] | null {
  const { imageWidth, imageHeight } = record.lens;
  const insetX = (imageWidth * (1 - usableFraction)) / 2;
  const insetY = (imageHeight * (1 - usableFraction)) / 2;
  const left = insetX;
  const right = imageWidth - 1 - insetX;
  const top = insetY;
  const bottom = imageHeight - 1 - insetY;
  const corners: Vec2[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  const toBed = bedMapper(record.lens, record.pose);
  const outline: Vec2[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const from = corners[edge] as Vec2;
    const to = corners[(edge + 1) % 4] as Vec2;
    for (let i = 0; i < EDGE_SAMPLES; i += 1) {
      const t = i / EDGE_SAMPLES;
      const point = toBed(
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        surfaceHeightMm,
      );
      if (point === null) return null;
      outline.push(point);
    }
  }
  return outline;
}

// Grows an upright box about the outline's centre, keeping the outline's own
// proportions, until a corner or side midpoint would leave it.
function largestUprightBox(outline: ReadonlyArray<Vec2>): BedArea | null {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const halfW = (maxX - minX) / 2;
  const halfH = (maxY - minY) / 2;
  if (!insidePolygon(centre, outline) || !(halfW > 0 && halfH > 0)) return null;
  let inside = 0;
  let outside = 1;
  if (boxInside(centre, halfW, halfH, outline)) inside = 1;
  else {
    for (let step = 0; step < FIT_STEPS; step += 1) {
      const scale = (inside + outside) / 2;
      if (boxInside(centre, halfW * scale, halfH * scale, outline)) inside = scale;
      else outside = scale;
    }
  }
  if (!(inside > 0)) return null;
  const w = halfW * inside;
  const h = halfH * inside;
  return { x: centre.x - w, y: centre.y - h, width: 2 * w, height: 2 * h };
}

function boxInside(
  centre: Vec2,
  halfW: number,
  halfH: number,
  outline: ReadonlyArray<Vec2>,
): boolean {
  for (const [sx, sy] of BOX_PROBES) {
    if (!insidePolygon({ x: centre.x + sx * halfW, y: centre.y + sy * halfH }, outline)) {
      return false;
    }
  }
  return true;
}

const BOX_PROBES: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

function insidePolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i] as Vec2;
    const b = polygon[j] as Vec2;
    if (a.y > point.y !== b.y > point.y) {
      const x = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

export type HeadCapturePlan = {
  /** Head positions (scene mm) in the order to visit them. */
  readonly heads: ReadonlyArray<Vec2>;
  /** False when the head cannot travel far enough for the camera to see all of the area. */
  readonly coversArea: boolean;
};

/**
 * Where to stop the head so that `view` (relative to the head) covers `area`,
 * row by row in a snake. Stops stay on the bed; where that keeps the camera
 * from reaching part of the area, `coversArea` says so.
 */
export function planHeadCaptures(
  view: BedArea,
  area: BedArea,
  bed: { readonly width: number; readonly height: number },
  overlap = HEAD_CAPTURE_OVERLAP,
): HeadCapturePlan {
  const columns = axisStops(area.x, area.width, view.x, view.width, bed.width, overlap);
  const rows = axisStops(area.y, area.height, view.y, view.height, bed.height, overlap);
  const heads: Vec2[] = [];
  rows.stops.forEach((y, row) => {
    const order = row % 2 === 0 ? columns.stops : [...columns.stops].reverse();
    for (const x of order) heads.push({ x, y });
  });
  return { heads, coversArea: columns.covers && rows.covers };
}

type AxisStops = { readonly stops: ReadonlyArray<number>; readonly covers: boolean };

function axisStops(
  start: number,
  length: number,
  viewStart: number,
  viewLength: number,
  bedLength: number,
  overlap: number,
): AxisStops {
  const centres =
    length <= viewLength
      ? [start + length / 2]
      : evenlySpaced(
          start + viewLength / 2,
          start + length - viewLength / 2,
          Math.ceil((length - viewLength) / (viewLength * (1 - overlap))) + 1,
        );
  const stops = centres.map((c) => clamp(c - viewStart - viewLength / 2, 0, bedLength));
  return { stops, covers: seen(stops, viewStart, viewLength, start, start + length) };
}

function evenlySpaced(from: number, to: number, count: number): number[] {
  if (count <= 1) return [(from + to) / 2];
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

// Whether the views from `stops`, in order, leave no gap between from and to.
function seen(
  stops: ReadonlyArray<number>,
  viewStart: number,
  viewLength: number,
  from: number,
  to: number,
): boolean {
  const tolerance = 1e-6;
  let reached = from;
  for (const stop of [...stops].sort((a, b) => a - b)) {
    const lo = stop + viewStart;
    if (lo > reached + tolerance) return false;
    reached = Math.max(reached, lo + viewLength);
  }
  return reached >= to - tolerance;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
