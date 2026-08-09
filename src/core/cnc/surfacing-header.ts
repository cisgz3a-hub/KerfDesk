import type {
  SurfacingOutputDifferenceField,
  SurfacingOutputParams,
  SurfacingOutputPrecisionEvidence,
} from './surfacing-output-precision';
import {
  formatSurfacingExactNumber as exact,
  formatSurfacingInteger,
  formatSurfacingNumber,
} from './surfacing-number-format';

export type SurfacingCoverageEvidence =
  | { readonly kind: 'nominal-complete'; readonly maxEmittedCenterGapMm: number }
  | {
      readonly kind: 'nominal-gap';
      readonly bitDiameterMm: number;
      readonly maxEmittedCenterGapMm: number;
      readonly nominalUncutGapMm: number;
    };

type SurfacingHeaderPlanningEvidence =
  | { readonly kind: 'complete' }
  | {
      readonly kind: 'pass-limit';
      readonly requestedYCoverageMm: number;
      readonly achievedYCoverageMm: number;
      readonly requestedDepthMm: number;
      readonly achievedDepthMm: number;
    };

export function buildSurfacingHeader(
  params: SurfacingOutputParams,
  planning: SurfacingHeaderPlanningEvidence,
  coverage: SurfacingCoverageEvidence,
  outputPrecision: SurfacingOutputPrecisionEvidence | null,
): ReadonlyArray<string> {
  const lines = ['; KerfDesk spoilboard surfacing'];
  const incompleteReasons: string[] = [];
  if (planning.kind === 'pass-limit') incompleteReasons.push('PASS LIMIT REACHED');
  if (coverage.kind === 'nominal-gap') incompleteReasons.push('NOMINAL COVERAGE GAPS');
  if (outputPrecision !== null) incompleteReasons.push('OUTPUT VALUES DIFFER');
  if (incompleteReasons.length > 0) {
    lines.push(`; *** INCOMPLETE SURFACING PROGRAM: ${incompleteReasons.join(' + ')} ***`);
  }
  if (planning.kind === 'pass-limit') lines.push(...passLimitHeader(planning));
  if (coverage.kind === 'nominal-gap') lines.push(coverageGapHeader(coverage));
  if (outputPrecision !== null) lines.push(...outputPrecisionHeader(outputPrecision));
  lines.push(
    `; area ${formatSurfacingNumber(params.widthMm)} x ${formatSurfacingNumber(params.heightMm)} mm, bit ${formatSurfacingNumber(params.bitDiameterMm)} mm, stepover ${exact(params.stepoverPct)}%`,
    '; zero X/Y at the front-left corner of the area, Z0 on the surface to face',
  );
  return lines;
}

function passLimitHeader(
  planning: Extract<SurfacingHeaderPlanningEvidence, { readonly kind: 'pass-limit' }>,
): ReadonlyArray<string> {
  return [
    `; requested Y coverage: ${formatSurfacingNumber(planning.requestedYCoverageMm)} mm; achieved Y coverage: ${formatSurfacingNumber(planning.achievedYCoverageMm)} mm`,
    `; requested depth: ${formatSurfacingNumber(planning.requestedDepthMm)} mm; achieved depth: ${formatSurfacingNumber(planning.achievedDepthMm)} mm`,
  ];
}

function coverageGapHeader(evidence: Extract<SurfacingCoverageEvidence, { kind: 'nominal-gap' }>) {
  return `; nominal row coverage: bit ${exact(evidence.bitDiameterMm)} mm; largest emitted center gap ${exact(evidence.maxEmittedCenterGapMm)} mm; nominal uncut gap ${exact(evidence.nominalUncutGapMm)} mm`;
}

function outputPrecisionHeader(evidence: SurfacingOutputPrecisionEvidence): ReadonlyArray<string> {
  return evidence.affectedFields.flatMap((field) => outputPrecisionHeaderFor(field, evidence));
}

function outputPrecisionHeaderFor(
  field: SurfacingOutputDifferenceField,
  evidence: SurfacingOutputPrecisionEvidence,
): ReadonlyArray<string> {
  const scalarLines: Partial<Readonly<Record<SurfacingOutputDifferenceField, string>>> = {
    'x-extent': `; output X extent: requested ${exact(evidence.requestedWidthMm)} mm; achieved ${formatSurfacingNumber(evidence.achievedWidthMm)} mm`,
    'safe-z': `; output safe Z: requested ${exact(evidence.requestedSafeZMm)} mm; achieved Z${formatSurfacingNumber(evidence.achievedSafeZMm)}`,
    feed: `; output feed: requested ${exact(evidence.requestedFeedMmPerMin)} mm/min; achieved F${formatSurfacingNumber(evidence.achievedFeedMmPerMin)}`,
    'plunge-feed': `; output plunge: requested ${exact(evidence.requestedPlungeMmPerMin)} mm/min; achieved F${formatSurfacingNumber(evidence.achievedPlungeMmPerMin)}`,
    'spindle-rpm': `; output spindle: requested ${exact(evidence.requestedSpindleRpm)} RPM; achieved S${formatSurfacingInteger(evidence.achievedSpindleRpm)}`,
    'spindle-spinup': `; output spin-up: requested ${exact(evidence.requestedSpindleSpinupSec)} s; achieved P${formatSurfacingNumber(evidence.achievedSpindleSpinupSec)}`,
  };
  const scalarLine = scalarLines[field];
  if (scalarLine !== undefined) return [scalarLine];
  if (field === 'y-coordinates') {
    return [
      `; output Y extent: planned ${exact(evidence.plannedYExtentMm)} mm; achieved ${formatSurfacingNumber(evidence.achievedYExtentMm)} mm`,
      `; output Y step: requested ${exact(evidence.requestedRowStepMm)} mm; ${evidence.plannedRows} planned / ${evidence.distinctEmittedYCoordinates} emitted coordinates`,
    ];
  }
  return [
    `; output depth: planned ${exact(evidence.plannedDeepestDepthMm)} mm; achieved ${formatSurfacingNumber(evidence.achievedDeepestDepthMm)} mm`,
    `; output stepdown: requested ${exact(evidence.requestedDepthPerPassMm)} mm; ${evidence.plannedDepthLevels} planned / ${evidence.distinctEmittedDepthCoordinates} emitted Z levels`,
  ];
}
