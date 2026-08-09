import { formatSurfacingNumber } from './surfacing-number-format';

export type SurfacingOutputDifferenceField =
  | 'x-extent'
  | 'y-coordinates'
  | 'safe-z'
  | 'feed'
  | 'plunge-feed'
  | 'spindle-rpm'
  | 'spindle-spinup'
  | 'depth-levels';

export type SurfacingOutputPrecisionEvidence = {
  readonly kind: 'output-precision';
  readonly affectedFields: ReadonlyArray<SurfacingOutputDifferenceField>;
  readonly requestedWidthMm: number;
  readonly achievedWidthMm: number;
  readonly requestedRowStepMm: number;
  readonly plannedYExtentMm: number;
  readonly achievedYExtentMm: number;
  readonly plannedRows: number;
  readonly distinctEmittedYCoordinates: number;
  readonly requestedSafeZMm: number;
  readonly achievedSafeZMm: number;
  readonly requestedFeedMmPerMin: number;
  readonly achievedFeedMmPerMin: number;
  readonly requestedPlungeMmPerMin: number;
  readonly achievedPlungeMmPerMin: number;
  readonly requestedSpindleRpm: number;
  readonly achievedSpindleRpm: number;
  readonly requestedSpindleSpinupSec: number;
  readonly achievedSpindleSpinupSec: number;
  readonly requestedDepthPerPassMm: number;
  readonly plannedDeepestDepthMm: number;
  readonly achievedDeepestDepthMm: number;
  readonly plannedDepthLevels: number;
  readonly distinctEmittedDepthCoordinates: number;
};

export type SurfacingEmittedCoordinateSummary = {
  readonly plannedFinalMm: number;
  readonly achievedFinalMm: number;
  readonly plannedCount: number;
  readonly distinctEmittedCoordinates: number;
  readonly differs: boolean;
};

export type SurfacingOutputParams = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bitDiameterMm: number;
  readonly stepoverPct: number;
  readonly depthPerPassMm: number;
  readonly totalDepthMm: number;
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly spindleSpinupSec: number;
  readonly safeZMm: number;
};

const MATERIAL_OUTPUT_DIFFERENCE_TOLERANCE = 1e-9;

export function summarizeSurfacingEmittedCoordinates(
  planned: ReadonlyArray<number>,
  negative: boolean,
): SurfacingEmittedCoordinateSummary {
  let previous = '';
  let achievedFinalMm = 0;
  let distinctEmittedCoordinates = 0;
  let differs = false;
  for (const value of planned) {
    const encoded = formatSurfacingNumber(negative ? -value : value);
    const achieved = negative ? Math.abs(Number(encoded)) : Number(encoded);
    if (encoded !== previous) distinctEmittedCoordinates += 1;
    if (materialOutputDifference(value, achieved)) differs = true;
    previous = encoded;
    achievedFinalMm = achieved;
  }
  return {
    plannedFinalMm: planned.at(-1) ?? 0,
    achievedFinalMm,
    plannedCount: planned.length,
    distinctEmittedCoordinates,
    differs,
  };
}

export function buildSurfacingOutputPrecisionEvidence(
  params: SurfacingOutputParams,
  stepMm: number,
  yOutput: SurfacingEmittedCoordinateSummary,
  depthOutput: SurfacingEmittedCoordinateSummary,
): SurfacingOutputPrecisionEvidence | null {
  const achievedWidthMm = emittedThreeDecimal(params.widthMm);
  const achievedSafeZMm = emittedThreeDecimal(params.safeZMm);
  const achievedFeedMmPerMin = emittedThreeDecimal(params.feedMmPerMin);
  const achievedPlungeMmPerMin = emittedThreeDecimal(params.plungeMmPerMin);
  const achievedSpindleRpm = Math.round(params.spindleRpm);
  const achievedSpindleSpinupSec = emittedThreeDecimal(params.spindleSpinupSec);
  const affectedFields = affectedOutputFields(params, yOutput, depthOutput, {
    achievedWidthMm,
    achievedSafeZMm,
    achievedFeedMmPerMin,
    achievedPlungeMmPerMin,
    achievedSpindleRpm,
    achievedSpindleSpinupSec,
  });
  if (affectedFields.length === 0) return null;
  return {
    kind: 'output-precision',
    affectedFields,
    requestedWidthMm: params.widthMm,
    achievedWidthMm,
    requestedRowStepMm: stepMm,
    plannedYExtentMm: yOutput.plannedFinalMm,
    achievedYExtentMm: yOutput.achievedFinalMm,
    plannedRows: yOutput.plannedCount,
    distinctEmittedYCoordinates: yOutput.distinctEmittedCoordinates,
    requestedSafeZMm: params.safeZMm,
    achievedSafeZMm,
    requestedFeedMmPerMin: params.feedMmPerMin,
    achievedFeedMmPerMin,
    requestedPlungeMmPerMin: params.plungeMmPerMin,
    achievedPlungeMmPerMin,
    requestedSpindleRpm: params.spindleRpm,
    achievedSpindleRpm,
    requestedSpindleSpinupSec: params.spindleSpinupSec,
    achievedSpindleSpinupSec,
    requestedDepthPerPassMm: params.depthPerPassMm,
    plannedDeepestDepthMm: depthOutput.plannedFinalMm,
    achievedDeepestDepthMm: depthOutput.achievedFinalMm,
    plannedDepthLevels: depthOutput.plannedCount,
    distinctEmittedDepthCoordinates: depthOutput.distinctEmittedCoordinates,
  };
}

type AchievedScalarOutputs = {
  readonly achievedWidthMm: number;
  readonly achievedSafeZMm: number;
  readonly achievedFeedMmPerMin: number;
  readonly achievedPlungeMmPerMin: number;
  readonly achievedSpindleRpm: number;
  readonly achievedSpindleSpinupSec: number;
};

function affectedOutputFields(
  params: SurfacingOutputParams,
  yOutput: SurfacingEmittedCoordinateSummary,
  depthOutput: SurfacingEmittedCoordinateSummary,
  achieved: AchievedScalarOutputs,
): ReadonlyArray<SurfacingOutputDifferenceField> {
  const fields: SurfacingOutputDifferenceField[] = [];
  if (materialOutputDifference(params.widthMm, achieved.achievedWidthMm)) fields.push('x-extent');
  if (yOutput.differs || yOutput.distinctEmittedCoordinates < yOutput.plannedCount) {
    fields.push('y-coordinates');
  }
  if (materialOutputDifference(params.safeZMm, achieved.achievedSafeZMm)) fields.push('safe-z');
  if (materialOutputDifference(params.feedMmPerMin, achieved.achievedFeedMmPerMin)) {
    fields.push('feed');
  }
  if (materialOutputDifference(params.plungeMmPerMin, achieved.achievedPlungeMmPerMin)) {
    fields.push('plunge-feed');
  }
  if (materialOutputDifference(params.spindleRpm, achieved.achievedSpindleRpm)) {
    fields.push('spindle-rpm');
  }
  if (materialOutputDifference(params.spindleSpinupSec, achieved.achievedSpindleSpinupSec)) {
    fields.push('spindle-spinup');
  }
  if (depthOutput.differs || depthOutput.distinctEmittedCoordinates < depthOutput.plannedCount) {
    fields.push('depth-levels');
  }
  return fields;
}

function emittedThreeDecimal(value: number): number {
  return Number(formatSurfacingNumber(value));
}

function materialOutputDifference(requested: number, achieved: number): boolean {
  if (requested > 0 && achieved === 0) return true;
  return Math.abs(requested - achieved) > MATERIAL_OUTPUT_DIFFERENCE_TOLERANCE;
}
