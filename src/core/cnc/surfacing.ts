// Spoilboard surfacing program generator (ADR-103 G8, F-CNC25) — the
// gSender/OpenBuilds-style facing wizard. Serpentine rows over a W×H area,
// stepping by a fraction of the bit diameter, one full raster per depth
// step until the total depth is reached. Standalone program: it assumes the
// operator zeroed X/Y at the area's front-left corner and Z on the surface
// to be faced. Pure and deterministic (no clock, no randomness).

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

export type SurfacingRowsResult =
  | { readonly ok: true; readonly rows: ReadonlyArray<number> }
  | { readonly ok: false; readonly reason: string };

export type SurfacingProgramResult =
  | { readonly ok: true; readonly program: SurfacingProgram }
  | { readonly ok: false; readonly reason: string };

export const SURFACING_DEFAULT_STEPOVER_PCT = 40;
export const SURFACING_DEFAULT_DEPTH_PER_PASS_MM = 0.5;
export const SURFACING_DEFAULT_TOTAL_DEPTH_MM = 0.5;

const MIN_STEPOVER_PCT = 10;
const MAX_STEPOVER_PCT = 100;
const MIN_STEP_MM = 0.05;
// Hard ceiling on serpentine rows / depth passes so a pathological but finite
// height or total depth (e.g. 1e12 mm) cannot exhaust memory building the
// arrays. 100k rows is ~a 5 m area at the 0.05 mm minimum step — far beyond
// any real bed — so no valid job is affected. Checked before allocation.
const MAX_SURFACING_ITERATIONS = 100_000;
const POSITIVE_FINITE_REASON = 'must be a positive finite number.';
const NON_NEGATIVE_FINITE_REASON = 'must be a non-negative finite number.';

function fmt(value: number): string {
  const text = value.toFixed(3);
  return text === '-0.000' ? '0.000' : text;
}

// Row centers 0..heightMm inclusive; the final row lands exactly on the far
// edge so the whole area is faced even when the height doesn't divide.
export function surfacingRowYs(heightMm: number, stepMm: number): SurfacingRowsResult {
  const heightReason = positiveFiniteReason('height', heightMm);
  if (heightReason !== null) return { ok: false, reason: heightReason };
  const stepReason = positiveFiniteReason('step', stepMm);
  if (stepReason !== null) return { ok: false, reason: stepReason };
  const capReason = iterationCapReason('row', heightMm, stepMm);
  if (capReason !== null) return { ok: false, reason: capReason };

  const rows: number[] = [];
  for (let y = 0; y < heightMm; y += stepMm) rows.push(y);
  rows.push(heightMm);
  return { ok: true, rows };
}

export function buildSurfacingProgram(params: SurfacingParams): SurfacingProgramResult {
  const paramReason = validateSurfacingParams(params);
  if (paramReason !== null) return { ok: false, reason: paramReason };

  const stepover = Math.min(MAX_STEPOVER_PCT, Math.max(MIN_STEPOVER_PCT, params.stepoverPct));
  const stepMm = Math.max(MIN_STEP_MM, (params.bitDiameterMm * stepover) / 100);
  const rowResult = surfacingRowYs(params.heightMm, stepMm);
  if (!rowResult.ok) return rowResult;
  const { rows } = rowResult;
  const depthResult = depthLadder(params.depthPerPassMm, params.totalDepthMm);
  if (!depthResult.ok) return depthResult;
  const { depths } = depthResult;
  const lines: string[] = [
    '; KerfDesk spoilboard surfacing',
    `; area ${fmt(params.widthMm)} x ${fmt(params.heightMm)} mm, bit ${fmt(params.bitDiameterMm)} mm, stepover ${stepover}%`,
    '; zero X/Y at the front-left corner of the area, Z0 on the surface to face',
    'G21',
    'G90',
    `G0 Z${fmt(params.safeZMm)}`,
    `M3 S${Math.round(params.spindleRpm)}`,
    `G4 P${params.spindleSpinupSec.toFixed(3)}`,
  ];
  for (const depth of depths) {
    lines.push('G0 X0.000 Y0.000');
    lines.push(`G1 Z${fmt(-depth)} F${fmt(params.plungeMmPerMin)}`);
    rows.forEach((y, index) => {
      if (index > 0) lines.push(`G1 Y${fmt(y)} F${fmt(params.feedMmPerMin)}`);
      // Serpentine: even rows cut toward +X, odd rows back toward 0.
      lines.push(`G1 X${fmt(index % 2 === 0 ? params.widthMm : 0)} F${fmt(params.feedMmPerMin)}`);
    });
    lines.push(`G0 Z${fmt(params.safeZMm)}`);
  }
  lines.push('M5');
  lines.push('G0 X0.000 Y0.000');
  return { ok: true, program: { lines, passes: depths.length, rowsPerPass: rows.length } };
}

type DepthLadderResult =
  | { readonly ok: true; readonly depths: ReadonlyArray<number> }
  | { readonly ok: false; readonly reason: string };

function depthLadder(perPassMm: number, totalMm: number): DepthLadderResult {
  const step = Math.max(MIN_STEP_MM, perPassMm);
  const total = Math.max(MIN_STEP_MM, totalMm);
  const capReason = iterationCapReason('depth pass', total, step);
  if (capReason !== null) return { ok: false, reason: capReason };
  const depths: number[] = [];
  for (let depth = step; depth < total; depth += step) depths.push(depth);
  depths.push(total);
  return { ok: true, depths };
}

function iterationCapReason(label: string, spanMm: number, stepMm: number): string | null {
  return spanMm / stepMm <= MAX_SURFACING_ITERATIONS
    ? null
    : `Surfacing ${label} count exceeds the ${MAX_SURFACING_ITERATIONS} limit.`;
}

function validateSurfacingParams(params: SurfacingParams): string | null {
  return (
    positiveFiniteReason('width', params.widthMm) ??
    positiveFiniteReason('height', params.heightMm) ??
    positiveFiniteReason('bit diameter', params.bitDiameterMm) ??
    positiveFiniteReason('stepover', params.stepoverPct) ??
    positiveFiniteReason('depth per pass', params.depthPerPassMm) ??
    positiveFiniteReason('total depth', params.totalDepthMm) ??
    positiveFiniteReason('feed', params.feedMmPerMin) ??
    positiveFiniteReason('plunge feed', params.plungeMmPerMin) ??
    positiveFiniteReason('spindle RPM', params.spindleRpm) ??
    nonNegativeFiniteReason('spindle spin-up', params.spindleSpinupSec) ??
    positiveFiniteReason('safe Z', params.safeZMm)
  );
}

function positiveFiniteReason(label: string, value: number): string | null {
  return Number.isFinite(value) && value > 0
    ? null
    : `Surfacing ${label} ${POSITIVE_FINITE_REASON}`;
}

function nonNegativeFiniteReason(label: string, value: number): string | null {
  return Number.isFinite(value) && value >= 0
    ? null
    : `Surfacing ${label} ${NON_NEGATIVE_FINITE_REASON}`;
}
