// How far the picture may be off on the bed beyond the target's rings
// (ADR-441 Amendment 9, rolling audit v13 Y1-P2-1). The rings measure the
// calibration only where they are; past them the lens model extrapolates,
// and on a part-bed sheet the audit measured 2.6-36 mm at the far bed while
// the rings read 0.06 mm. Nothing measured that, so the grade said "Accurate
// enough" there too.
//
// The estimate: refit the same rings with the other lens models that fit them
// as well (fewer or more distortion terms), and with each half of the rings
// on its own, then see how far those fits disagree with the saved one on the
// bed outside the target. Where the rings pin the picture down they agree;
// where the picture is extrapolated their spread is how much the rings leave
// open. It is an estimate, not a measurement, and is reported as one. Pure
// core.
//
// Amendment 11 (camera audit v2 K1-P1-1, K1-P2-1). Every low-order fit of
// the same rings shares one bias past them, so their spread alone under-read
// ordinary centred webcams 2-3 times (graded good at 2.7-4.5 mm off), and
// peaked at the far corners while the truth peaks at the near ones, at the
// largest image radius. So:
// - the other term counts are real fits with that many terms (a lens that
//   folds inside the picture, or fits the rings clearly worse, is left out),
//   not fits that drop the extra term again;
// - every fit keeps the saved camera height, so a typed tape height is not
//   undone by the alternatives;
// - a floor that does not depend on the lens model: past the rings' image
//   radius the error is allowed to grow by FLOOR_PER_PIXEL of each pixel
//   further out, as measured on independent truth lenses.

import {
  bedMapper,
  bedPoint,
  cameraCentre,
  projectWorldPoint,
  type LensModel,
  type Vec2,
} from './camera-model';
import type { CameraModelRecord } from './camera-model-record';
import { fitCameraModel, type ObservedPoint } from './fit-camera-model';
import { lensFoldsInPicture } from './fit-determined-lens';

/** Up to this far off beyond the rings, the whole bed still counts as good
 * for placing artwork by eye; past it the grade and Job Review say so. */
export const GOOD_EXTRAPOLATED_MM = 1.5;

export type ExtrapolationEstimate = {
  /** The largest estimated error on the bed outside the target, mm. */
  readonly worstMm: number;
  /** Where on the bed that is. */
  readonly worstAt: Vec2;
  /** The bed the estimate covers, from the target laid out centred on it. */
  readonly bed: { readonly width: number; readonly height: number };
  /** The estimate on a grid over the bed (null where the camera does not see it), mm. */
  readonly grid: ExtrapolationGrid;
};

export type ExtrapolationGrid = {
  readonly stepMm: number;
  readonly columns: number;
  readonly rows: number;
  /** Row-major, `columns × rows`; NaN where the camera does not see the bed. */
  readonly errorMm: Float64Array;
};

// Fewer rings than this leave too little to refit halves of.
const MIN_RINGS = 12;
// The sample grid: this many steps across the longer side of the bed.
const GRID_STEPS = 40;
// The ring count from which the calibration fits four lens terms (bed-calibration.ts).
const FULL_DISTORTION_MIN_RINGS = 60;
const TWO_TERM_MIN_RINGS = 40;
// The fits' spread tracked the true error at 0.5 to 1.5 times on rendered
// lenses of another family than the fitted one; it is scaled so the estimate
// is rarely below the truth (ADR-441 Amendment 9).
const SPREAD_TO_ERROR = 1.5;
// The principal-point prior the calibration itself fits with (bed-calibration.ts).
const PRINCIPAL_POINT_SIGMA_SHARE = 0.02;
// A typed tape height's sigma in the calibration (bed-calibration.ts).
const HEIGHT_PRIOR_SIGMA_MM = 15;
// A term-count alternative fits the rings about as well as the saved model or
// is left out: a worse fit's disagreement says nothing about this calibration.
const ALTERNATIVE_RMS_SHARE = 1.25;
const ALTERNATIVE_RMS_SLACK_PX = 0.03;
// Past the rings' image radius, pixels of error per pixel further out. On 28
// independent truth cameras (centred, off-centre and rolled webcams, 4:3 and
// 16:9, fisheyes, a phone straight down) the true error at the worst point
// grew by 0.002-0.028 px per pixel past the rings. At 0.025, with the fits'
// spread, the estimate was at least 0.81 times the truth wherever the truth
// was over 1.5 mm; at 0.02 it was 0.65 times.
const FLOOR_PER_PIXEL = 0.025;

const cache = new Map<string, ExtrapolationEstimate | null>();

/** The estimate for a fixed camera's saved calibration, or null when it cannot be made. */
export function extrapolationEstimate(record: CameraModelRecord): ExtrapolationEstimate | null {
  if (record.mount?.kind === 'head' || record.accuracy.targetArea === undefined) return null;
  const key = cacheKey(record);
  const known = cache.get(key);
  if (known !== undefined) return known;
  const estimate = estimate_(record);
  if (cache.size > 16) cache.clear();
  cache.set(key, estimate);
  return estimate;
}

/** The largest estimate over the grid points within `box` (bed mm), or null when the camera sees none of it. */
export function estimateWithin(
  estimate: Pick<ExtrapolationEstimate, 'grid'>,
  box: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
): number | null {
  const { stepMm, columns, rows, errorMm } = estimate.grid;
  // The grid points around the box too, so a small job between them is seen.
  const i0 = Math.max(0, Math.floor(box.minX / stepMm));
  const i1 = Math.min(columns - 1, Math.ceil(box.maxX / stepMm));
  const j0 = Math.max(0, Math.floor(box.minY / stepMm));
  const j1 = Math.min(rows - 1, Math.ceil(box.maxY / stepMm));
  let most: number | null = null;
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const mm = errorMm[j * columns + i] ?? Number.NaN;
      if (Number.isFinite(mm)) most = Math.max(most ?? 0, mm);
    }
  }
  return most;
}

function cacheKey(record: CameraModelRecord): string {
  return JSON.stringify([
    record.calibratedAt,
    record.lens,
    record.pose,
    record.accuracy.targetArea,
    record.accuracy.targetHeightMm,
    record.accuracy.marks ?? [],
  ]);
}

function estimate_(record: CameraModelRecord): ExtrapolationEstimate | null {
  const area = record.accuracy.targetArea;
  if (area === undefined) return null;
  const points = observedRings(record);
  if (points.length < MIN_RINGS) return null;
  const alternatives = alternativeLenses(record, points);
  if (alternatives.length === 0) return null;
  const bed = { width: 2 * area.x + area.width, height: 2 * area.y + area.height };
  const grid = sampleBed(record, alternatives, bed, ringSupport(record.lens, points));
  let worst = { mm: 0, at: { x: bed.width / 2, y: bed.height / 2 } };
  for (let j = 0; j < grid.rows; j += 1) {
    for (let i = 0; i < grid.columns; i += 1) {
      const mm = grid.errorMm[j * grid.columns + i] ?? Number.NaN;
      const at = gridPoint(grid, bed, i, j);
      if (mm > worst.mm && !insideArea(area, at)) worst = { mm, at };
    }
  }
  return { worstMm: worst.mm, worstAt: worst.at, bed, grid };
}

type BedSize = ExtrapolationEstimate['bed'];

// The estimate at every grid point the camera sees (NaN elsewhere).
function sampleBed(
  record: CameraModelRecord,
  alternatives: ReadonlyArray<Alternative>,
  bed: BedSize,
  support: RingSupport,
): ExtrapolationGrid {
  const stepMm = Math.max(bed.width, bed.height) / GRID_STEPS;
  const columns = Math.floor(bed.width / stepMm) + 1;
  const rows = Math.floor(bed.height / stepMm) + 1;
  const errorMm = new Float64Array(columns * rows).fill(Number.NaN);
  const grid = { stepMm, columns, rows, errorMm };
  const { lens, pose } = record;
  const height = record.accuracy.targetHeightMm;
  const saved = bedMapper(lens, pose);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const at = gridPoint(grid, bed, i, j);
      const pixel = projectWorldPoint(lens, pose, bedPoint(at.x, at.y, height));
      if (pixel === null || !inPicture(lens, pixel)) continue;
      const floor = floorAt(lens, saved, pixel, at, height, support.radiusPx);
      const spread = spreadAt(alternatives, pixel, at, height) * awayFromRings(at, support);
      errorMm[j * columns + i] = Math.max(spread, floor);
    }
  }
  return grid;
}

function gridPoint(
  grid: Pick<ExtrapolationGrid, 'stepMm'>,
  bed: BedSize,
  i: number,
  j: number,
): Vec2 {
  return { x: Math.min(i * grid.stepMm, bed.width), y: Math.min(j * grid.stepMm, bed.height) };
}

function insideArea(
  area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  at: Vec2,
): boolean {
  return (
    at.x >= area.x && at.y >= area.y && at.x <= area.x + area.width && at.y <= area.y + area.height
  );
}

// The rings as the photo saw them: each saved error is where the saved model
// put the ring's pixel, so the pixel is the saved model's projection of it.
function observedRings(record: CameraModelRecord): ObservedPoint[] {
  const height = record.accuracy.targetHeightMm;
  const points: ObservedPoint[] = [];
  for (const mark of record.accuracy.marks ?? []) {
    if (mark.rejected === true) continue;
    const pixel = projectWorldPoint(
      record.lens,
      record.pose,
      bedPoint(mark.x + mark.dxMm, mark.y + mark.dyMm, height),
    );
    if (pixel !== null) points.push({ world: bedPoint(mark.x, mark.y, height), pixel });
  }
  return points;
}

type Alternative = { readonly toBed: ReturnType<typeof bedMapper> };

// Other fits as good on the rings: the other numbers of lens terms on all of
// them, and the saved number on each half (left, right, front, back).
function alternativeLenses(record: CameraModelRecord, points: ObservedPoint[]): Alternative[] {
  const terms = distortionTermsOf(record.lens);
  const xs = points.map((p) => p.world.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.world.y).sort((a, b) => a - b);
  const midX = xs[Math.floor(xs.length / 2)] ?? 0;
  const midY = ys[Math.floor(ys.length / 2)] ?? 0;
  const halves = [
    points.filter((p) => p.world.x <= midX),
    points.filter((p) => p.world.x >= midX),
    points.filter((p) => p.world.y <= midY),
    points.filter((p) => p.world.y >= midY),
  ];
  // Four terms only from as many rings as the calibration itself needs for
  // them: on fewer they bend the picture tens of millimetres past the rings
  // (ADR-441 Amendment 8), which says nothing about this calibration.
  const termCounts =
    points.length >= FULL_DISTORTION_MIN_RINGS ? ([1, 2, 4] as const) : ([1, 2] as const);
  const fits: Array<{ readonly points: ObservedPoint[]; readonly terms: 1 | 2 | 4 }> = [
    ...termCounts.filter((t) => t !== terms).map((t) => ({ points, terms: t })),
    ...halves
      .filter((half) => half.length >= MIN_RINGS / 2)
      .map((half) => ({
        points: half,
        terms: Math.min(terms, termsForRings(half.length)) as 1 | 2 | 4,
      })),
  ];
  const savedRms = rmsPx(record.lens, record.pose, points);
  const alternatives: Alternative[] = [];
  for (const fit of fits) {
    const fitted = fitCameraModel([{ points: fit.points }], {
      imageWidth: record.lens.imageWidth,
      imageHeight: record.lens.imageHeight,
      distortionTerms: fit.terms,
      principalPointSigmaPx: PRINCIPAL_POINT_SIGMA_SHARE * record.lens.imageWidth,
      cameraHeightPrior: { heightMm: -cameraCentre(record.pose).z, sigmaMm: HEIGHT_PRIOR_SIGMA_MM },
    });
    const pose = fitted.kind === 'ok' ? fitted.poses[0] : undefined;
    if (fitted.kind !== 'ok' || pose === undefined || lensFoldsInPicture(fitted.lens)) continue;
    // A half fits its own rings; only a fit of all of them must match the saved one's.
    const allRings = fit.points === points;
    if (allRings && rmsPx(fitted.lens, pose, points) > fitsAsWell(savedRms)) continue;
    alternatives.push({ toBed: bedMapper(fitted.lens, pose) });
  }
  return alternatives;
}

function fitsAsWell(savedRms: number): number {
  return Math.max(ALTERNATIVE_RMS_SHARE * savedRms, savedRms + ALTERNATIVE_RMS_SLACK_PX);
}

function rmsPx(
  lens: LensModel,
  pose: CameraModelRecord['pose'],
  points: ReadonlyArray<ObservedPoint>,
): number {
  let sum = 0;
  let count = 0;
  for (const point of points) {
    const seen = projectWorldPoint(lens, pose, point.world);
    if (seen === null) continue;
    sum += (seen.x - point.pixel.x) ** 2 + (seen.y - point.pixel.y) ** 2;
    count += 1;
  }
  return count === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(sum / count);
}

// Where the rings pin the model down: their farthest image radius from the
// principal point, their places on the bed, and their spacing there.
type RingSupport = {
  readonly radiusPx: number;
  readonly rings: ReadonlyArray<Vec2>;
  readonly pitchMm: number;
};

function ringSupport(lens: LensModel, points: ReadonlyArray<ObservedPoint>): RingSupport {
  const { cx, cy } = lens.intrinsics;
  const radiusPx = points.reduce(
    (most, p) => Math.max(most, Math.hypot(p.pixel.x - cx, p.pixel.y - cy)),
    0,
  );
  const rings = points.map((p) => ({ x: p.world.x, y: p.world.y }));
  const nearest = rings.map((ring) => nearestRingMm(ring, rings, ring)).sort((a, b) => a - b);
  return { radiusPx, rings, pitchMm: nearest[Math.floor(nearest.length / 2)] ?? 0 };
}

function nearestRingMm(at: Vec2, rings: ReadonlyArray<Vec2>, skip?: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    if (ring === skip) continue;
    best = Math.min(best, Math.hypot(ring.x - at.x, ring.y - at.y));
  }
  return best;
}

// Within about a ring spacing of a ring the saved model is held by that ring,
// so the halves' disagreement there is their own extrapolation, not the saved
// model's: it counts from half a spacing out and fully from one and a half.
// A full-bed sheet's corners were graded fair at 1.8-5.3 mm while 0.3-0.5 mm
// off (K1-P2-1).
function awayFromRings(at: Vec2, support: RingSupport): number {
  if (support.pitchMm <= 0) return 1;
  const distance = nearestRingMm(at, support.rings);
  return Math.min(1, Math.max(0, (distance - support.pitchMm / 2) / support.pitchMm));
}

// The model-independent floor at a pixel past the rings: the pixel moved
// outward by FLOOR_PER_PIXEL of its distance past the rings' radius, as the
// saved model puts that on the bed.
function floorAt(
  lens: LensModel,
  saved: ReturnType<typeof bedMapper>,
  pixel: Vec2,
  at: Vec2,
  height: number,
  ringRadius: number,
): number {
  const { cx, cy } = lens.intrinsics;
  const radius = Math.hypot(pixel.x - cx, pixel.y - cy);
  const past = radius - ringRadius;
  if (past <= 0 || radius === 0) return 0;
  const shift = FLOOR_PER_PIXEL * past;
  for (const sign of [1, -1]) {
    const moved = {
      x: pixel.x + (sign * shift * (pixel.x - cx)) / radius,
      y: pixel.y + (sign * shift * (pixel.y - cy)) / radius,
    };
    const seen = saved(moved, height);
    if (seen !== null) return Math.hypot(seen.x - at.x, seen.y - at.y);
  }
  return 0;
}

// As many lens terms as the calibration itself fits from this many rings
// (bed-calibration.ts): a half refitted with more bends past its rings.
function termsForRings(rings: number): 1 | 2 | 4 {
  if (rings >= FULL_DISTORTION_MIN_RINGS) return 4;
  return rings >= TWO_TERM_MIN_RINGS ? 2 : 1;
}

function distortionTermsOf(lens: LensModel): 1 | 2 | 4 {
  const used = lens.distortion.reduce((last, term, index) => (term !== 0 ? index + 1 : last), 0);
  return used >= 3 ? 4 : used === 2 ? 2 : 1;
}

function spreadAt(
  alternatives: ReadonlyArray<Alternative>,
  pixel: Vec2,
  at: Vec2,
  height: number,
): number {
  let most = 0;
  for (const alternative of alternatives) {
    const seen = alternative.toBed(pixel, height);
    if (seen !== null) most = Math.max(most, Math.hypot(seen.x - at.x, seen.y - at.y));
  }
  return SPREAD_TO_ERROR * most;
}

function inPicture(lens: LensModel, pixel: Vec2): boolean {
  return (
    pixel.x >= 0 &&
    pixel.y >= 0 &&
    pixel.x <= lens.imageWidth - 1 &&
    pixel.y <= lens.imageHeight - 1
  );
}
