// Spoilboard surfacing program generator (ADR-103 G8, F-CNC25) — the
// gSender/OpenBuilds-style facing wizard. Serpentine rows over a W×H area,
// stepping by a fraction of the bit diameter, one full raster per depth
// step until the total depth is reached. Standalone program: it assumes the
// operator zeroed X/Y at the area's front-left corner and Z on the surface
// to be faced. Pure and deterministic (no clock, no randomness).

import { finiteOr, finitePositiveOr } from '../util';

export type SurfacingParams = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bitDiameterMm: number;
  /** Row spacing as a percentage of bit diameter (10–100). */
  readonly stepoverPct: number;
  readonly depthPerPassMm: number;
  readonly totalDepthMm: number;
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly spindleSpinupSec: number;
  readonly safeZMm: number;
};

export type SurfacingProgram = {
  readonly lines: ReadonlyArray<string>;
  readonly passes: number;
  readonly rowsPerPass: number;
};

export const SURFACING_DEFAULT_STEPOVER_PCT = 40;
export const SURFACING_DEFAULT_DEPTH_PER_PASS_MM = 0.5;
export const SURFACING_DEFAULT_TOTAL_DEPTH_MM = 0.5;

const MIN_STEPOVER_PCT = 10;
const MAX_STEPOVER_PCT = 100;
const MIN_STEP_MM = 0.05;
// Fallback feed for a non-finite/non-positive feed input — a slow, safe rate,
// not the MIN_STEP_MM distance constant. Only fires when a caller passes garbage.
const MIN_FALLBACK_FEED_MM_PER_MIN = 1;
// Hard ceiling on serpentine rows / depth passes so a pathological finite
// height or step cannot exhaust memory. 100k iterations is ~a 5 m area at the
// 0.05 mm minimum step — far beyond any real bed — so no valid job is affected.
const MAX_SURFACING_ITERATIONS = 100_000;

function fmt(value: number): string {
  const text = value.toFixed(3);
  return text === '-0.000' ? '0.000' : text;
}

// Row centers 0..heightMm inclusive; the final row lands exactly on the far
// edge so the whole area is faced even when the height doesn't divide.
export function surfacingRowYs(heightMm: number, stepMm: number): ReadonlyArray<number> {
  // Fail closed: a non-finite height spins the loop forever, and a non-finite,
  // zero, or denormal step never advances it (once y/step exceeds 2^53,
  // y += step is a no-op). Floor the step at MIN_STEP_MM and cap the row count
  // so a pathological finite height cannot exhaust memory either.
  const safeHeight = finitePositiveOr(heightMm, 0);
  const safeStep = Math.max(MIN_STEP_MM, finiteOr(stepMm, MIN_STEP_MM));
  const rows: number[] = [];
  for (let y = 0; y < safeHeight && rows.length < MAX_SURFACING_ITERATIONS; y += safeStep) {
    rows.push(y);
  }
  rows.push(safeHeight);
  return rows;
}

export function buildSurfacingProgram(params: SurfacingParams): SurfacingProgram {
  // Fail closed on non-finite params so no "NaN"/"Infinity" reaches G-code.
  const widthMm = finitePositiveOr(params.widthMm, MIN_STEP_MM);
  const heightMm = finitePositiveOr(params.heightMm, MIN_STEP_MM);
  const bitDiameterMm = finitePositiveOr(params.bitDiameterMm, MIN_STEP_MM);
  const feedMmPerMin = finitePositiveOr(params.feedMmPerMin, MIN_FALLBACK_FEED_MM_PER_MIN);
  const plungeMmPerMin = finitePositiveOr(params.plungeMmPerMin, MIN_FALLBACK_FEED_MM_PER_MIN);
  // Clamp to >= 0 so a finite negative rpm can't emit `M3 S-12000`.
  const spindleRpm = Math.max(0, finiteOr(params.spindleRpm, 0));
  const spindleSpinupSec = finiteOr(params.spindleSpinupSec, 0);
  const safeZMm = finiteOr(params.safeZMm, 0);
  const stepover = Math.min(
    MAX_STEPOVER_PCT,
    Math.max(MIN_STEPOVER_PCT, finiteOr(params.stepoverPct, MIN_STEPOVER_PCT)),
  );
  const stepMm = Math.max(MIN_STEP_MM, (bitDiameterMm * stepover) / 100);
  const rows = surfacingRowYs(heightMm, stepMm);
  const depths = depthLadder(params.depthPerPassMm, params.totalDepthMm);
  const lines: string[] = [
    '; KerfDesk spoilboard surfacing',
    `; area ${fmt(widthMm)} x ${fmt(heightMm)} mm, bit ${fmt(bitDiameterMm)} mm, stepover ${stepover}%`,
    '; zero X/Y at the front-left corner of the area, Z0 on the surface to face',
    'G21',
    'G90',
    `M3 S${Math.round(spindleRpm)}`,
    `G4 P${spindleSpinupSec.toFixed(3)}`,
    `G0 Z${fmt(safeZMm)}`,
  ];
  for (const depth of depths) {
    lines.push('G0 X0.000 Y0.000');
    lines.push(`G1 Z${fmt(-depth)} F${fmt(plungeMmPerMin)}`);
    rows.forEach((y, index) => {
      if (index > 0) lines.push(`G1 Y${fmt(y)} F${fmt(feedMmPerMin)}`);
      // Serpentine: even rows cut toward +X, odd rows back toward 0.
      lines.push(`G1 X${fmt(index % 2 === 0 ? widthMm : 0)} F${fmt(feedMmPerMin)}`);
    });
    lines.push(`G0 Z${fmt(safeZMm)}`);
  }
  lines.push('M5');
  lines.push('G0 X0.000 Y0.000');
  return { lines, passes: depths.length, rowsPerPass: rows.length };
}

function depthLadder(perPassMm: number, totalMm: number): ReadonlyArray<number> {
  // Clamp to MIN_STEP_MM (restores the pre-guard valid-path behavior: a finite
  // sub-0.05 mm pass still floors to 0.05 rather than exploding the pass count),
  // while finiteOr keeps a non-finite input from producing NaN/Infinity depths.
  // The iteration cap guards against a pathological finite total.
  const step = Math.max(MIN_STEP_MM, finiteOr(perPassMm, MIN_STEP_MM));
  const total = Math.max(MIN_STEP_MM, finiteOr(totalMm, MIN_STEP_MM));
  const depths: number[] = [];
  for (let depth = step; depth < total && depths.length < MAX_SURFACING_ITERATIONS; depth += step) {
    depths.push(depth);
  }
  depths.push(total);
  return depths;
}
