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

import { bedMapper, bedPoint, projectWorldPoint, type LensModel, type Vec2 } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';
import type { ObservedPoint } from './fit-camera-model';
import { fitDeterminedLens } from './fit-determined-lens';

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
// The fits' spread tracked the true error at 0.5 to 1.5 times on rendered
// lenses of another family than the fitted one; it is scaled so the estimate
// is rarely below the truth (ADR-441 Amendment 9).
const SPREAD_TO_ERROR = 1.5;
// The principal-point prior the calibration itself fits with (bed-calibration.ts).
const PRINCIPAL_POINT_SIGMA_SHARE = 0.02;

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
  const grid = sampleBed(record, alternatives, bed);
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
): ExtrapolationGrid {
  const stepMm = Math.max(bed.width, bed.height) / GRID_STEPS;
  const columns = Math.floor(bed.width / stepMm) + 1;
  const rows = Math.floor(bed.height / stepMm) + 1;
  const errorMm = new Float64Array(columns * rows).fill(Number.NaN);
  const grid = { stepMm, columns, rows, errorMm };
  const { lens, pose } = record;
  const height = record.accuracy.targetHeightMm;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const at = gridPoint(grid, bed, i, j);
      const pixel = projectWorldPoint(lens, pose, bedPoint(at.x, at.y, height));
      if (pixel === null || !inPicture(lens, pixel)) continue;
      errorMm[j * columns + i] = spreadAt(alternatives, pixel, at, height);
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
      .map((half) => ({ points: half, terms })),
  ];
  const alternatives: Alternative[] = [];
  for (const fit of fits) {
    const fitted = fitDeterminedLens([{ points: fit.points }], {
      imageWidth: record.lens.imageWidth,
      imageHeight: record.lens.imageHeight,
      distortionTerms: fit.terms,
      principalPointSigmaPx: PRINCIPAL_POINT_SIGMA_SHARE * record.lens.imageWidth,
    });
    const pose = fitted.kind === 'ok' ? fitted.poses[0] : undefined;
    if (fitted.kind === 'ok' && pose !== undefined) {
      alternatives.push({ toBed: bedMapper(fitted.lens, pose) });
    }
  }
  return alternatives;
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
