// Find the marks of the engraved bed target in a camera frame (ADR-441). A
// mark is a dark ring around a light hole. Rings are chosen over solid dots
// because topology survives perspective, fisheye squeeze and exposure
// changes, and because nothing else on a laser bed has it: honeycomb cells,
// slats, screws and shadows are solid dark blobs or light lines, never a dark
// loop around a light centre. The three anchors are solid discs of the same
// outer size: a solid disc as large as its neighbouring rings is equally
// unusual on a bed, and it stays solid when the camera is too far away to
// resolve a dot inside a ring (the first design, which fragmented).
//
// Pipeline: local-mean adaptive threshold (integral image), 8-connected dark
// components and 4-connected light components (the pairing that keeps holes
// topologically well defined), then hole ownership decides rings and anchors.
// Pure core: deterministic, no I/O.

import type { GrayImage } from '../corner-subpix';
import { labelComponents, type ComponentStats } from './components';

export type RingMark = {
  /** Centre of the filled disc (ring + hole), sub-pixel. */
  readonly x: number;
  readonly y: number;
  /** Pixel area of the filled disc; the matcher compares neighbours by it. */
  readonly area: number;
  readonly anchor: boolean;
};

export type RingDetectOptions = {
  /** Adaptive-threshold window in px; defaults to 1/24 of the shorter side. */
  readonly windowPx?: number;
  /** How much darker than the local mean a pixel must be (grey levels). */
  readonly offset?: number;
  readonly minAreaPx?: number;
};

const DEFAULT_OFFSET = 8;
const DEFAULT_MIN_AREA = 30;
// A ring's hole holds at least this share of the filled disc, and its centre
// sits within this share of the disc radius of the ring's own centre.
const MIN_HOLE_SHARE = 0.15;
const MAX_HOLE_OFFSET = 0.35;
// An elongated disc is a stretched circle; beyond this it is something else.
const MAX_ELONGATION = 6;
// An anchor disc is the rings' size give or take perspective across one step.
const ANCHOR_MIN_AREA_RATIO = 0.55;
const ANCHOR_MAX_AREA_RATIO = 1.8;
// Grid step over disc radius is 8 by design; perspective moves it both ways.
const ANCHOR_MIN_GAP = 3;
const ANCHOR_MAX_GAP = 16;
// Every anchor sits inside the grid with ring neighbours one step away on
// every side. The reach allows for a tilted camera, which shortens the steps
// along one axis.
const ANCHOR_NEIGHBOUR_REACH = 1.6;
const ANCHOR_MIN_NEIGHBOURS = 3;
// Widest direction with no ring neighbour an anchor may have, radians. Every
// anchor sits inside the grid, so its neighbours surround it.
const ANCHOR_MAX_EMPTY_ARC = 0.8 * Math.PI;

export function detectRingMarks(img: GrayImage, options: RingDetectOptions = {}): RingMark[] {
  const dark = adaptiveDarkMask(img, options);
  const labels = labelComponents(dark, img.width, img.height);
  const rings: RingMark[] = [];
  const minArea = options.minAreaPx ?? DEFAULT_MIN_AREA;
  const solids: ComponentStats[] = [];
  for (const component of labels.dark) {
    if (component.touchesBorder || component.area < minArea) continue;
    const hole = labels.holeOf.get(component.id);
    // A pinhole of sensor noise inside a solid disc is not a ring's hole.
    if (hole === undefined || hole.area < MIN_HOLE_SHARE * (component.area + hole.area)) {
      solids.push(hole === undefined ? component : merged(component, hole));
      continue;
    }
    const mark = ringMark(component, hole, labels.innerDotOf.get(hole.id));
    if (mark !== null) rings.push(mark);
  }
  return [...rings, ...anchorDiscs(solids, rings)];
}

// Solid discs that look like a ring's twin: about the size of the nearest
// ring and about one grid step from it. Sizes are compared locally because
// perspective makes near marks several times larger than far ones, so a
// single global size would admit honeycomb cells near the camera.
function anchorDiscs(
  solids: ReadonlyArray<ComponentStats>,
  rings: ReadonlyArray<RingMark>,
): RingMark[] {
  const anchors: RingMark[] = [];
  for (const disc of solids) {
    const x = disc.sumX / disc.area;
    const y = disc.sumY / disc.area;
    const nearest = nearestRing(rings, x, y);
    if (nearest === null) continue;
    const ratio = disc.area / nearest.ring.area;
    if (ratio < ANCHOR_MIN_AREA_RATIO || ratio > ANCHOR_MAX_AREA_RATIO) continue;
    const radius = Math.sqrt(disc.area / Math.PI);
    if (nearest.distance < ANCHOR_MIN_GAP * radius || nearest.distance > ANCHOR_MAX_GAP * radius)
      continue;
    if (!enclosedByRings(rings, x, y, ANCHOR_NEIGHBOUR_REACH * nearest.distance)) continue;
    if (elongation(disc) > MAX_ELONGATION) continue;
    anchors.push({ x, y, area: disc.area, anchor: true });
  }
  return anchors;
}

function merged(a: ComponentStats, b: ComponentStats): ComponentStats {
  return {
    id: a.id,
    area: a.area + b.area,
    sumX: a.sumX + b.sumX,
    sumY: a.sumY + b.sumY,
    sumXX: a.sumXX + b.sumXX,
    sumYY: a.sumYY + b.sumYY,
    sumXY: a.sumXY + b.sumXY,
    touchesBorder: a.touchesBorder,
  };
}

// True when enough rings lie within reach and they surround the point: no
// empty half-plane around it. A blob of honeycomb just past the sheet's edge
// can have several rings nearby, but all of them on the sheet's side.
function enclosedByRings(
  rings: ReadonlyArray<RingMark>,
  x: number,
  y: number,
  reach: number,
): boolean {
  const angles: number[] = [];
  for (const ring of rings) {
    if (Math.hypot(ring.x - x, ring.y - y) <= reach)
      angles.push(Math.atan2(ring.y - y, ring.x - x));
  }
  if (angles.length < ANCHOR_MIN_NEIGHBOURS) return false;
  angles.sort((a, b) => a - b);
  let widestGap = 2 * Math.PI - ((angles[angles.length - 1] ?? 0) - (angles[0] ?? 0));
  for (let i = 1; i < angles.length; i += 1) {
    widestGap = Math.max(widestGap, (angles[i] ?? 0) - (angles[i - 1] ?? 0));
  }
  return widestGap < ANCHOR_MAX_EMPTY_ARC;
}

function nearestRing(
  rings: ReadonlyArray<RingMark>,
  x: number,
  y: number,
): { readonly ring: RingMark; readonly distance: number } | null {
  let best: { readonly ring: RingMark; readonly distance: number } | null = null;
  for (const ring of rings) {
    const distance = Math.hypot(ring.x - x, ring.y - y);
    if (best === null || distance < best.distance) best = { ring, distance };
  }
  return best;
}

function ringMark(
  ring: ComponentStats,
  hole: ComponentStats,
  dot: ComponentStats | undefined,
): RingMark | null {
  // A dot left in the middle of the hole is part of the hole.
  const inner = sumMoments([hole, dot]);
  const filled = sumMoments([ring, inner]);
  const { area } = filled;
  if (inner.area < MIN_HOLE_SHARE * area) return null;
  const x = filled.sumX / area;
  const y = filled.sumY / area;
  const radius = Math.sqrt(area / Math.PI);
  const offset = Math.hypot(inner.sumX / inner.area - x, inner.sumY / inner.area - y);
  if (offset > MAX_HOLE_OFFSET * radius) return null;
  if (elongation(filled) > MAX_ELONGATION) return null;
  return { x, y, area, anchor: false };
}

type Moments = Pick<ComponentStats, 'area' | 'sumX' | 'sumY' | 'sumXX' | 'sumYY' | 'sumXY'>;

function sumMoments(parts: ReadonlyArray<Moments | undefined>): Moments {
  const sum = { area: 0, sumX: 0, sumY: 0, sumXX: 0, sumYY: 0, sumXY: 0 };
  for (const part of parts) {
    if (part === undefined) continue;
    sum.area += part.area;
    sum.sumX += part.sumX;
    sum.sumY += part.sumY;
    sum.sumXX += part.sumXX;
    sum.sumYY += part.sumYY;
    sum.sumXY += part.sumXY;
  }
  return sum;
}

// Ratio of the principal axes of the filled shape's second moments.
function elongation(m: Moments): number {
  const x = m.sumX / m.area;
  const y = m.sumY / m.area;
  const cxx = m.sumXX / m.area - x * x;
  const cyy = m.sumYY / m.area - y * y;
  const cxy = m.sumXY / m.area - x * y;
  const mean = (cxx + cyy) / 2;
  const spread = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
  const minor = mean - spread;
  return minor > 0 ? Math.sqrt((mean + spread) / minor) : Number.POSITIVE_INFINITY;
}

/** 1 where a pixel is darker than its neighbourhood mean by `offset`. */
export function adaptiveDarkMask(img: GrayImage, options: RingDetectOptions = {}): Uint8Array {
  const { width, height, data } = img;
  const window = options.windowPx ?? Math.max(15, Math.round(Math.min(width, height) / 24));
  const half = Math.max(1, Math.floor(window / 2));
  const offset = options.offset ?? DEFAULT_OFFSET;
  const integral = integralImage(img);
  const stride = width + 1;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const sum =
        (integral[y1 * stride + x1] ?? 0) -
        (integral[y0 * stride + x1] ?? 0) -
        (integral[y1 * stride + x0] ?? 0) +
        (integral[y0 * stride + x0] ?? 0);
      const mean = sum / ((x1 - x0) * (y1 - y0));
      mask[y * width + x] = (data[y * width + x] ?? 0) < mean - offset ? 1 : 0;
    }
  }
  return mask;
}

function integralImage(img: GrayImage): Float64Array {
  const { width, height, data } = img;
  const stride = width + 1;
  const out = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += data[y * width + x] ?? 0;
      out[(y + 1) * stride + x + 1] = (out[y * stride + x + 1] ?? 0) + row;
    }
  }
  return out;
}
