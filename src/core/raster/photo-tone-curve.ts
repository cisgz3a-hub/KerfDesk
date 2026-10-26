// ADR-670: per-material photo tone calibration. A burned dot is wider than its
// burn-grid cell and every material darkens differently, so a dithered tone
// burns darker than the photo asked for. A grey step wedge, engraved with the
// photo's own settings, measures that response once. Its inverse is applied to
// the luma the ditherer sees (after Negative), so the canvas, the Photo
// engraving preview and the G-code all burn the same corrected tones.

/**
 * Luma in → luma out on the burn side, after Negative: 255 is no mark and 0 a
 * solid mark. Inputs rise strictly from 0 to 255; outputs never fall and also
 * run from 0 to 255, so blank material stays blank and solid stays solid.
 */
export type PhotoToneCurvePoint = { readonly input: number; readonly output: number };

export type PhotoToneCurve = {
  readonly label: string;
  readonly points: ReadonlyArray<PhotoToneCurvePoint>;
};

/** One recorded wedge patch: the mark strength asked for and the one seen, 0..100 %. */
export type PhotoToneSample = {
  readonly commandedPercent: number;
  readonly observedPercent: number;
};

export const PHOTO_TONE_CURVE_MAX_POINTS = 64;
export const PHOTO_TONE_LABEL_MAX_LENGTH = 120;

const BYTE_MAX = 255;
const LEVELS = BYTE_MAX + 1;
const PERCENT_MAX = 100;
// A recorded run of equal greys has no single inverse. Blending this share of
// the identity into the measured response keeps the fitted curve continuous and
// strictly rising, so a flat run becomes a steep but finite step.
const IDENTITY_BLEND = 0.02;
const POINT_DECIMALS = 100;

const lutCache = new WeakMap<PhotoToneCurve, Uint8Array>();

/**
 * Fit the correction for a recorded wedge. The measured response (commanded →
 * observed mark strength) is made monotonic by isotonic regression, pinned to
 * 0 → 0 and 100 → 100, and inverted: the result tells the ditherer how strong a
 * tone to ask for so the material shows the tone the photo wanted.
 */
export function fitPhotoToneCurve(
  samples: ReadonlyArray<PhotoToneSample>,
  label: string,
): PhotoToneCurve {
  const response = monotonicResponse(samples);
  const points: PhotoToneCurvePoint[] = [];
  for (let index = response.length - 1; index >= 0; index -= 1) {
    const sample = response[index];
    if (sample === undefined) continue;
    const observed =
      (1 - IDENTITY_BLEND) * sample.observedPercent + IDENTITY_BLEND * sample.commandedPercent;
    const input = roundPoint(percentToLuma(observed));
    const output = roundPoint(percentToLuma(sample.commandedPercent));
    const previous = points[points.length - 1];
    if (previous !== undefined && input <= previous.input) continue;
    points.push({ input, output: Math.max(output, previous?.output ?? 0) });
  }
  // Blank material stays blank even when rounding merged the last two points.
  if (points[points.length - 1]?.input === BYTE_MAX) points.pop();
  points.push({ input: BYTE_MAX, output: BYTE_MAX });
  return { label: label.trim().slice(0, PHOTO_TONE_LABEL_MAX_LENGTH), points };
}

/** The measured response, pooled into a non-decreasing run with fixed end points. */
function monotonicResponse(samples: ReadonlyArray<PhotoToneSample>): PhotoToneSample[] {
  const byCommanded = new Map<number, number[]>();
  for (const sample of samples) {
    const commanded = clampPercent(sample.commandedPercent);
    if (commanded <= 0 || commanded >= PERCENT_MAX) continue;
    const observed = byCommanded.get(commanded) ?? [];
    observed.push(clampPercent(sample.observedPercent));
    byCommanded.set(commanded, observed);
  }
  const ordered = [...byCommanded.entries()]
    .sort(([a], [b]) => a - b)
    .map(([commandedPercent, observed]) => ({
      commandedPercent,
      observedPercent: observed.reduce((sum, value) => sum + value, 0) / observed.length,
    }));
  const pooled = poolAdjacentViolators(ordered.map((sample) => sample.observedPercent));
  return [
    { commandedPercent: 0, observedPercent: 0 },
    ...ordered.map((sample, index) => ({ ...sample, observedPercent: pooled[index] ?? 0 })),
    { commandedPercent: PERCENT_MAX, observedPercent: PERCENT_MAX },
  ];
}

/** Least-squares non-decreasing fit (pool-adjacent-violators), equal weights. */
export function poolAdjacentViolators(values: ReadonlyArray<number>): number[] {
  const blocks: { sum: number; count: number }[] = [];
  for (const value of values) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const before = blocks[blocks.length - 2];
      if (last === undefined || before === undefined) break;
      if (before.sum / before.count <= last.sum / last.count) break;
      blocks.pop();
      before.sum += last.sum;
      before.count += last.count;
    }
  }
  return blocks.flatMap((block) => Array<number>(block.count).fill(block.sum / block.count));
}

/** A curve the project may hold: well-formed, monotonic and pinned at both ends. */
export function isPhotoToneCurve(value: unknown): value is PhotoToneCurve {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const { label, points } = record;
  if (typeof label !== 'string' || label.length > PHOTO_TONE_LABEL_MAX_LENGTH) return false;
  if (!Array.isArray(points)) return false;
  if (points.length < 2 || points.length > PHOTO_TONE_CURVE_MAX_POINTS) return false;
  if (!points.every(isCurvePoint)) return false;
  return curvePointsAreMonotonic(points as ReadonlyArray<PhotoToneCurvePoint>);
}

function isCurvePoint(value: unknown): value is PhotoToneCurvePoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { input, output } = value as Record<string, unknown>;
  return isByteRange(input) && isByteRange(output);
}

function curvePointsAreMonotonic(points: ReadonlyArray<PhotoToneCurvePoint>): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return false;
  if (first.input !== 0 || first.output !== 0) return false;
  if (last.input !== BYTE_MAX || last.output !== BYTE_MAX) return false;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) return false;
    if (point.input <= previous.input || point.output < previous.output) return false;
  }
  return true;
}

/** True when every point lies on the diagonal: burning with it changes nothing. */
export function isIdentityPhotoToneCurve(curve: PhotoToneCurve): boolean {
  return curve.points.every((point) => point.input === point.output);
}

/** The 256-entry table the curve applies, cached per (immutable) curve. */
export function photoToneCurveLut(curve: PhotoToneCurve): Uint8Array {
  const cached = lutCache.get(curve);
  if (cached !== undefined) return cached;
  const lut = new Uint8Array(LEVELS);
  for (let level = 0; level < LEVELS; level += 1) {
    lut[level] = Math.max(0, Math.min(BYTE_MAX, Math.round(evaluatePhotoToneCurve(curve, level))));
  }
  lutCache.set(curve, lut);
  return lut;
}

/** Piecewise-linear value of the curve at one luma, clamped to its ends. */
export function evaluatePhotoToneCurve(curve: PhotoToneCurve, input: number): number {
  const { points } = curve;
  const first = points[0];
  if (first === undefined || input <= first.input) return first?.output ?? input;
  for (let index = 1; index < points.length; index += 1) {
    const end = points[index];
    const start = points[index - 1];
    if (end === undefined || start === undefined) break;
    if (input <= end.input) {
      const t = (input - start.input) / (end.input - start.input);
      return start.output + t * (end.output - start.output);
    }
  }
  return points[points.length - 1]?.output ?? input;
}

/**
 * Apply the curve to the luma the ditherer will see. Absent or identity curves
 * return the same array, so output without a calibration is byte-identical.
 */
export function applyPhotoToneCurve(
  luma: Uint8Array,
  curve: PhotoToneCurve | undefined,
): Uint8Array {
  if (curve === undefined || isIdentityPhotoToneCurve(curve)) return luma;
  const lut = photoToneCurveLut(curve);
  const out = new Uint8Array(luma.length);
  for (let index = 0; index < luma.length; index += 1) {
    out[index] = lut[luma[index] ?? BYTE_MAX] ?? BYTE_MAX;
  }
  return out;
}

export function photoToneCurvesEqual(
  left: PhotoToneCurve | undefined,
  right: PhotoToneCurve | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.label === right.label &&
    left.points.length === right.points.length &&
    left.points.every((point, index) => {
      const other = right.points[index];
      return other !== undefined && point.input === other.input && point.output === other.output;
    })
  );
}

/** The curve that changes nothing, for an override that turns a calibration off. */
export const IDENTITY_PHOTO_TONE_CURVE: PhotoToneCurve = {
  label: '',
  points: [
    { input: 0, output: 0 },
    { input: BYTE_MAX, output: BYTE_MAX },
  ],
};

/** Mark strength (0 % blank .. 100 % solid) as burn-side luma. */
export function percentToLuma(percent: number): number {
  return BYTE_MAX * (1 - clampPercent(percent) / PERCENT_MAX);
}

/** Burn-side luma as mark strength (0 % blank .. 100 % solid). */
export function lumaToPercent(luma: number): number {
  return PERCENT_MAX * (1 - Math.max(0, Math.min(BYTE_MAX, luma)) / BYTE_MAX);
}

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(PERCENT_MAX, value)) : 0;
}

function roundPoint(value: number): number {
  return Math.round(value * POINT_DECIMALS) / POINT_DECIMALS;
}

function isByteRange(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= BYTE_MAX;
}

/** A curve that changes something, or undefined: the identity curve means "none". */
export function activePhotoToneCurve(
  curve: PhotoToneCurve | undefined,
): PhotoToneCurve | undefined {
  return curve === undefined || isIdentityPhotoToneCurve(curve) ? undefined : curve;
}
