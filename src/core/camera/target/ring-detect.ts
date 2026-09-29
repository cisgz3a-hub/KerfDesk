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
  /**
   * Adaptive-threshold window in px. By default 1/24 of the shorter side, and
   * when that loses anchors, a second look with a window sized from the rings.
   */
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
// Every anchor sits inside the grid with ring neighbours around it. They are
// looked for in the nearest ring's round frame (see roundFrame), where a
// tilted camera's short steps along one axis are undone and the grid is square
// again: side neighbours one step (eight radii) away, diagonal ones about
// eleven radii. The reach, in that ring's radii, takes both with room for the
// perspective change across a step. Where the neighbour one step away is
// another anchor, not a ring, the diagonal rings still cover that side.
const ANCHOR_NEIGHBOUR_REACH_RADII = 14;
const ANCHOR_MIN_NEIGHBOURS = 3;
// Widest direction with no ring neighbour an anchor may have, radians. Every
// anchor sits inside the grid, so its neighbours surround it.
const ANCHOR_MAX_EMPTY_ARC = 0.8 * Math.PI;

// The anchors the target has; fewer found sends the detector for a second look.
const TARGET_ANCHORS = 3;
// The second look's window over the rings' median outer diameter. A solid
// disc stays dark to its middle only while the window reaches well past it;
// twice the rings' size also covers anchors that perspective makes larger.
const WINDOW_OVER_RING_DIAMETER = 2;

// A ring found, with the moments of its filled disc: its shape tells how the
// camera stretches the bed around it.
type Ring = { readonly mark: RingMark; readonly shape: Moments };

type Detection = {
  readonly rings: ReadonlyArray<Ring>;
  readonly anchors: ReadonlyArray<RingMark>;
};

export function detectRingMarks(img: GrayImage, options: RingDetectOptions = {}): RingMark[] {
  const first = detectWith(img, options);
  const found = (detection: Detection): RingMark[] => [
    ...detection.rings.map((ring) => ring.mark),
    ...detection.anchors,
  ];
  if (options.windowPx !== undefined || first.anchors.length >= TARGET_ANCHORS) return found(first);
  // The window was fixed before anything was seen. A solid disc wider than it
  // is no darker in its middle than the local mean there, so the anchor comes
  // out as a hollow ring or not at all; the rings, thin-stroked, survive and
  // give the marks' size in this picture.
  const windowPx = ringSizedWindow(first.rings, img);
  if (windowPx === null) return found(first);
  const second = detectWith(img, { ...options, windowPx });
  return second.anchors.length > first.anchors.length ? found(second) : found(first);
}

function detectWith(img: GrayImage, options: RingDetectOptions): Detection {
  const dark = adaptiveDarkMask(img, options);
  const labels = labelComponents(dark, img.width, img.height);
  const rings: Ring[] = [];
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
    const ring = ringOf(component, hole, labels.innerDotOf.get(hole.id));
    if (ring !== null) rings.push(ring);
  }
  return { rings, anchors: anchorDiscs(solids, rings) };
}

// A window twice the rings' median outer diameter, when that is larger than
// the default one; null when there are no rings or no larger window to try.
function ringSizedWindow(rings: ReadonlyArray<Ring>, img: GrayImage): number | null {
  const areas = rings.map((ring) => ring.mark.area).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  if (median === undefined) return null;
  const diameter = 2 * Math.sqrt(median / Math.PI);
  const windowPx = Math.min(
    Math.round(WINDOW_OVER_RING_DIAMETER * diameter),
    Math.min(img.width, img.height),
  );
  return windowPx > defaultWindowPx(img) ? windowPx : null;
}

function defaultWindowPx(img: GrayImage): number {
  return Math.max(15, Math.round(Math.min(img.width, img.height) / 24));
}

// Solid discs that look like a ring's twin: about the size of the nearest
// ring and about one grid step from it. Sizes are compared locally because
// perspective makes near marks several times larger than far ones, so a
// single global size would admit honeycomb cells near the camera.
function anchorDiscs(
  solids: ReadonlyArray<ComponentStats>,
  rings: ReadonlyArray<Ring>,
): RingMark[] {
  const anchors: RingMark[] = [];
  for (const disc of solids) {
    const x = disc.sumX / disc.area;
    const y = disc.sumY / disc.area;
    const nearest = nearestRing(rings, x, y);
    if (nearest === null) continue;
    const ratio = disc.area / nearest.ring.mark.area;
    if (ratio < ANCHOR_MIN_AREA_RATIO || ratio > ANCHOR_MAX_AREA_RATIO) continue;
    const radius = Math.sqrt(disc.area / Math.PI);
    if (nearest.distance < ANCHOR_MIN_GAP * radius || nearest.distance > ANCHOR_MAX_GAP * radius)
      continue;
    if (elongation(disc) > MAX_ELONGATION) continue;
    if (!enclosedByRings(rings, roundFrame(nearest.ring.shape, x, y))) continue;
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

// True when enough rings lie within reach of the disc and they surround it:
// no empty half-plane around it. A blob of honeycomb just past the sheet's
// edge can have several rings nearby, but all of them on the sheet's side,
// in any frame and at any reach. `toRound` maps a picture point to its offset
// from the disc in the nearest ring's round frame, whose stretch is that of
// the sheet next to the disc even when the disc is a blob of something else.
function enclosedByRings(
  rings: ReadonlyArray<Ring>,
  toRound: (x: number, y: number) => { x: number; y: number },
): boolean {
  const angles: number[] = [];
  for (const ring of rings) {
    const offset = toRound(ring.mark.x, ring.mark.y);
    if (Math.hypot(offset.x, offset.y) <= ANCHOR_NEIGHBOUR_REACH_RADII)
      angles.push(Math.atan2(offset.y, offset.x));
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
  rings: ReadonlyArray<Ring>,
  x: number,
  y: number,
): { readonly ring: Ring; readonly distance: number } | null {
  let best: { readonly ring: Ring; readonly distance: number } | null = null;
  for (const ring of rings) {
    const distance = Math.hypot(ring.mark.x - x, ring.mark.y - y);
    if (best === null || distance < best.distance) best = { ring, distance };
  }
  return best;
}

function ringOf(
  ring: ComponentStats,
  hole: ComponentStats,
  dot: ComponentStats | undefined,
): Ring | null {
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
  return { mark: { x, y, area, anchor: false }, shape: filled };
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

// Second central moments of a shape about its centre, px².
type Spread = { readonly cxx: number; readonly cyy: number; readonly cxy: number };

function spreadOf(m: Moments): Spread {
  const x = m.sumX / m.area;
  const y = m.sumY / m.area;
  return {
    cxx: m.sumXX / m.area - x * x,
    cyy: m.sumYY / m.area - y * y,
    cxy: m.sumXY / m.area - x * y,
  };
}

// A ring's filled disc is the picture of a round mark, so its second moments
// describe how the camera stretches the bed around it. This maps a picture
// point to its offset from (ox, oy) in the disc's radii, in the frame where
// the disc is round again (up to a rotation); the grid steps near the disc
// are stretched alike, so in that frame they are square.
function roundFrame(
  m: Moments,
  ox: number,
  oy: number,
): (x: number, y: number) => { x: number; y: number } {
  const { cxx, cyy, cxy } = spreadOf(m);
  // A round disc of radius r spreads r²/4 along every axis, so an offset d is
  // |d| / r radii where the disc is round: √(dᵀ S⁻¹ d) / 2. The Cholesky factor
  // of S⁻¹ gives that length's components: (a·dx + b·dy, c·dy).
  const det = cxx * cyy - cxy * cxy;
  const a = Math.sqrt(cyy / det) / 2;
  const b = -cxy / Math.sqrt(cyy * det) / 2;
  const c = 1 / Math.sqrt(cyy) / 2;
  return (x, y) => ({ x: a * (x - ox) + b * (y - oy), y: c * (y - oy) });
}

// Ratio of the principal axes of the filled shape's second moments.
function elongation(m: Moments): number {
  const { cxx, cyy, cxy } = spreadOf(m);
  const mean = (cxx + cyy) / 2;
  const spread = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
  const minor = mean - spread;
  return minor > 0 ? Math.sqrt((mean + spread) / minor) : Number.POSITIVE_INFINITY;
}

/** 1 where a pixel is darker than its neighbourhood mean by `offset`. */
export function adaptiveDarkMask(img: GrayImage, options: RingDetectOptions = {}): Uint8Array {
  const { width, height, data } = img;
  const window = options.windowPx ?? defaultWindowPx(img);
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
