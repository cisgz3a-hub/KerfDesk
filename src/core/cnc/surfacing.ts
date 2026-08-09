// Spoilboard surfacing program generator (ADR-103 G8, F-CNC25) — the
// gSender/OpenBuilds-style facing wizard. Serpentine rows over a W×H area,
// stepping by a fraction of the bit diameter, one full raster per depth
// step until the total depth is reached. Standalone program: it assumes the
// operator zeroed X/Y at the area's front-left corner and Z on the surface
// to be faced. Pure and deterministic (no clock, no randomness).

import {
  buildSurfacingOutputPrecisionEvidence as buildOutputPrecisionEvidence,
  summarizeSurfacingEmittedCoordinates as summarizeEmittedCoordinates,
} from './surfacing-output-precision';
import type { SurfacingOutputPrecisionEvidence } from './surfacing-output-precision';
import {
  buildSurfacingHeader as surfacingHeader,
  type SurfacingCoverageEvidence,
} from './surfacing-header';
import {
  formatSurfacingInteger as fmtInteger,
  formatSurfacingNumber as fmt,
} from './surfacing-number-format';

export type {
  SurfacingOutputDifferenceField,
  SurfacingOutputPrecisionEvidence,
} from './surfacing-output-precision';
export type { SurfacingCoverageEvidence } from './surfacing-header';

export type SurfacingParams = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bitDiameterMm: number;
  /** Exact positive row spacing as a percentage of bit diameter. */
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
  readonly planning: SurfacingPlanningEvidence;
  readonly coverage: SurfacingCoverageEvidence;
  readonly outputPrecision: SurfacingOutputPrecisionEvidence | null;
};

type SurfacingPlanMeasurements = {
  readonly stepoverPct: number;
  readonly stepMm: number;
  readonly generatedRowsPerPass: number;
  readonly generatedPasses: number;
  readonly generatedRouteRows: number;
};

export type SurfacingPassLimitStage = 'rows' | 'depth-passes';

export type SurfacingPlanningEvidence =
  | (SurfacingPlanMeasurements & { readonly kind: 'complete' })
  | (SurfacingPlanMeasurements & {
      readonly kind: 'pass-limit';
      readonly passLimit: number;
      readonly limitedStages: ReadonlyArray<SurfacingPassLimitStage>;
      readonly requestedYCoverageMm: number;
      readonly achievedYCoverageMm: number;
      readonly requestedDepthMm: number;
      readonly achievedDepthMm: number;
    });

type SurfacingPlanningTermination =
  | { readonly kind: 'complete' }
  | { readonly kind: 'pass-limit'; readonly passLimit: number };

export type SurfacingRowsResult =
  | {
      readonly ok: true;
      readonly rows: ReadonlyArray<number>;
      readonly termination: SurfacingPlanningTermination;
    }
  | { readonly ok: false; readonly reason: string };

export type SurfacingProgramResult =
  | { readonly ok: true; readonly program: SurfacingProgram }
  | { readonly ok: false; readonly reason: string };

export const SURFACING_DEFAULT_STEPOVER_PCT = 40;
export const SURFACING_DEFAULT_DEPTH_PER_PASS_MM = 0.5;
export const SURFACING_DEFAULT_TOTAL_DEPTH_MM = 0.5;

// Existing bounded-work budget, now reported as pass-limit evidence instead of
// refusing an exact positive input. It applies to rows across every depth pass,
// so the formerly unbounded rows x passes product cannot exhaust the process.
const MAX_SURFACING_ROUTE_ROWS = 100_000;
const POSITIVE_FINITE_REASON = 'must be a positive finite number.';

// Row centers 0..heightMm inclusive; the final row lands exactly on the far
// edge so the whole area is faced even when the height doesn't divide.
export function surfacingRowYs(heightMm: number, stepMm: number): SurfacingRowsResult {
  const heightReason = positiveFiniteReason('height', heightMm);
  if (heightReason !== null) return { ok: false, reason: heightReason };
  const stepReason = positiveFiniteReason('step', stepMm);
  if (stepReason !== null) return { ok: false, reason: stepReason };
  const rows: number[] = [];
  let y = 0;
  while (y < heightMm && rows.length < MAX_SURFACING_ROUTE_ROWS) {
    rows.push(y);
    y += stepMm;
  }
  if (y < heightMm || rows.length >= MAX_SURFACING_ROUTE_ROWS) {
    return {
      ok: true,
      rows,
      termination: { kind: 'pass-limit', passLimit: MAX_SURFACING_ROUTE_ROWS },
    };
  }
  rows.push(heightMm);
  return { ok: true, rows, termination: { kind: 'complete' } };
}

export function buildSurfacingProgram(params: SurfacingParams): SurfacingProgramResult {
  const paramReason = validateSurfacingParams(params);
  if (paramReason !== null) return { ok: false, reason: paramReason };

  const stepMm = (params.bitDiameterMm * params.stepoverPct) / 100;
  const rowResult = surfacingRowYs(params.heightMm, stepMm);
  if (!rowResult.ok) return rowResult;
  const { rows } = rowResult;
  const depthPassLimit = Math.max(1, Math.floor(MAX_SURFACING_ROUTE_ROWS / rows.length));
  const depthResult = depthLadder(params.depthPerPassMm, params.totalDepthMm, depthPassLimit);
  if (!depthResult.ok) return depthResult;
  const { depths } = depthResult;
  const yOutput = summarizeEmittedCoordinates(rows, false);
  const depthOutput = summarizeEmittedCoordinates(depths, true);
  const coverage = surfacingCoverageEvidence(rows, params.bitDiameterMm);
  const outputPrecision = buildOutputPrecisionEvidence(params, stepMm, yOutput, depthOutput);
  const limitedStages: SurfacingPassLimitStage[] = [];
  if (rowResult.termination.kind === 'pass-limit') limitedStages.push('rows');
  if (depthResult.termination.kind === 'pass-limit') limitedStages.push('depth-passes');
  const measurements: SurfacingPlanMeasurements = {
    stepoverPct: params.stepoverPct,
    stepMm,
    generatedRowsPerPass: rows.length,
    generatedPasses: depths.length,
    generatedRouteRows: rows.length * depths.length,
  };
  const planning: SurfacingPlanningEvidence =
    limitedStages.length === 0
      ? { kind: 'complete', ...measurements }
      : {
          kind: 'pass-limit',
          ...measurements,
          passLimit: MAX_SURFACING_ROUTE_ROWS,
          limitedStages,
          requestedYCoverageMm: params.heightMm,
          achievedYCoverageMm: yOutput.achievedFinalMm,
          requestedDepthMm: params.totalDepthMm,
          achievedDepthMm: depthOutput.achievedFinalMm,
        };
  const lines: string[] = [
    ...surfacingHeader(params, planning, coverage, outputPrecision),
    'G21',
    'G90',
    'G54',
    // A stale G93 would interpret every F word as inverse time and can turn
    // ordinary surfacing feeds into controller-max motion.
    'G94',
    // Same modal-state reasoning as G94: the plane survives from whatever the
    // console or a $N startup block last set, and surfacing shares its preamble
    // contract with the job emitter.
    'G17',
    `G0 Z${fmt(params.safeZMm)}`,
    `M3 S${fmtInteger(params.spindleRpm)}`,
  ];
  if (params.spindleSpinupSec > 0) lines.push(`G4 P${fmt(params.spindleSpinupSec)}`);
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
  return {
    ok: true,
    program: {
      lines,
      passes: depths.length,
      rowsPerPass: rows.length,
      planning,
      coverage,
      outputPrecision,
    },
  };
}

const NOMINAL_COVERAGE_TOLERANCE_MM = 1e-9;

function surfacingCoverageEvidence(
  rows: ReadonlyArray<number>,
  bitDiameterMm: number,
): SurfacingCoverageEvidence {
  let maxEmittedCenterGapMm = 0;
  let previous = Number(fmt(rows[0] ?? 0));
  for (const row of rows.slice(1)) {
    const emitted = Number(fmt(row));
    maxEmittedCenterGapMm = Math.max(maxEmittedCenterGapMm, emitted - previous);
    previous = emitted;
  }
  const nominalUncutGapMm = maxEmittedCenterGapMm - bitDiameterMm;
  if (nominalUncutGapMm <= NOMINAL_COVERAGE_TOLERANCE_MM) {
    return { kind: 'nominal-complete', maxEmittedCenterGapMm };
  }
  return { kind: 'nominal-gap', bitDiameterMm, maxEmittedCenterGapMm, nominalUncutGapMm };
}

type DepthLadderResult =
  | {
      readonly ok: true;
      readonly depths: ReadonlyArray<number>;
      readonly termination: SurfacingPlanningTermination;
    }
  | { readonly ok: false; readonly reason: string };

function depthLadder(perPassMm: number, totalMm: number, passLimit: number): DepthLadderResult {
  const depths: number[] = [];
  let depth = perPassMm;
  while (depth < totalMm && depths.length < passLimit) {
    depths.push(depth);
    depth += perPassMm;
  }
  if (depth < totalMm || depths.length >= passLimit) {
    return {
      ok: true,
      depths,
      termination: { kind: 'pass-limit', passLimit },
    };
  }
  depths.push(totalMm);
  return { ok: true, depths, termination: { kind: 'complete' } };
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
    spindleSpinupReason(params.spindleSpinupSec) ??
    positiveFiniteReason('safe Z', params.safeZMm)
  );
}

function positiveFiniteReason(label: string, value: number): string | null {
  return Number.isFinite(value) && value > 0
    ? null
    : `Surfacing ${label} ${POSITIVE_FINITE_REASON}`;
}

function spindleSpinupReason(value: number): string | null {
  return Number.isFinite(value) && value >= 0
    ? null
    : 'Surfacing spindle spin-up must be a finite number at or above 0 seconds.';
}
