import type { SurfacingProgram } from '../../core/cnc';

type SurfacingOutputPrecisionEvidence = NonNullable<SurfacingProgram['outputPrecision']>;
type SurfacingOutputDifferenceField = SurfacingOutputPrecisionEvidence['affectedFields'][number];

export function surfacingSaveSuccessMessage(
  program: Pick<
    SurfacingProgram,
    'coverage' | 'passes' | 'planning' | 'rowsPerPass' | 'outputPrecision'
  >,
  toolName: string,
): string {
  if (program.planning.kind === 'pass-limit') {
    return partialSaveMessage({ ...program, planning: program.planning }, toolName);
  }
  const differences = artifactDifferenceLabels(program);
  if (differences !== null) {
    return (
      `Saved a surfacing program with disclosed ${differences.kinds} (INCOMPLETE): ` +
      `${differences.details}. The artifact header records the evidence for ` +
      `${program.passes} pass(es) × ${program.rowsPerPass} rows with the ${toolName}.`
    );
  }
  return completeSaveMessage(program, toolName);
}

function completeSaveMessage(
  program: Pick<SurfacingProgram, 'passes' | 'rowsPerPass'>,
  toolName: string,
): string {
  return `Saved preflighted surfacing program: ${program.passes} pass(es) × ${program.rowsPerPass} rows with the ${toolName}. Zero X/Y at the area's front-left corner and Z on the surface before running; the file lifts to safe Z before spindle start.`;
}

function partialSaveMessage(
  program: Pick<
    SurfacingProgram,
    'coverage' | 'passes' | 'planning' | 'rowsPerPass' | 'outputPrecision'
  > & {
    readonly planning: Extract<SurfacingProgram['planning'], { readonly kind: 'pass-limit' }>;
  },
  toolName: string,
): string {
  const evidence = program.planning;
  const differences = artifactDifferenceLabels(program);
  const differencePhrase = differences === null ? '' : ` with disclosed ${differences.kinds}`;
  return (
    `Saved a bounded partial surfacing program${differencePhrase} (INCOMPLETE): ` +
    `requested Y coverage ${evidence.requestedYCoverageMm.toFixed(3)} mm; ` +
    `achieved Y coverage ${evidence.achievedYCoverageMm.toFixed(3)} mm; ` +
    `requested depth ${evidence.requestedDepthMm.toFixed(3)} mm; ` +
    `achieved depth ${evidence.achievedDepthMm.toFixed(3)} mm. The saved file contains ` +
    `${program.passes} pass(es) × ${program.rowsPerPass} rows with the ${toolName}. ` +
    "Zero X/Y at the area's front-left corner and Z on the surface before running; " +
    'the file lifts to safe Z before spindle start.'
  );
}

export function surfacingCoverageWarning(evidence: SurfacingProgram['coverage']): string | null {
  if (evidence.kind === 'nominal-complete') return null;
  return (
    `Surfacing rows leave a nominal uncut gap of ${evidence.nominalUncutGapMm} mm: ` +
    `the largest emitted row-center gap is ${evidence.maxEmittedCenterGapMm} mm with a ` +
    `${evidence.bitDiameterMm} mm bit. The warning does not prevent saving.`
  );
}

export function surfacingPlanningWarning(evidence: SurfacingProgram['planning']): string | null {
  if (evidence.kind === 'complete') return null;
  const unfinished = [
    evidence.limitedStages.includes('rows') ? 'area height' : null,
    evidence.limitedStages.includes('depth-passes') ? 'total depth' : null,
  ].filter((part): part is string => part !== null);
  return (
    `Surfacing planning reached the ${evidence.passLimit} route-row work limit before ` +
    `completing the requested ${unfinished.join(' and ')}. The generated program contains ` +
    `${evidence.generatedPasses} pass(es) x ${evidence.generatedRowsPerPass} row(s); ` +
    'the warning does not prevent saving.'
  );
}

export function surfacingOutputPrecisionWarning(
  evidence: SurfacingProgram['outputPrecision'],
): string | null {
  if (evidence === null) return null;
  return (
    `Surfacing output differs from accepted positive inputs in ${outputDifferenceLabels(evidence)}. ` +
    'The generated file is marked INCOMPLETE and records requested versus achieved values; ' +
    'the warning does not prevent saving.'
  );
}

const OUTPUT_DIFFERENCE_LABELS: Readonly<Record<SurfacingOutputDifferenceField, string>> = {
  'x-extent': 'X extent',
  'y-coordinates': 'Y coordinates',
  'safe-z': 'safe Z',
  feed: 'cutting feed',
  'plunge-feed': 'plunge feed',
  'spindle-rpm': 'spindle RPM',
  'spindle-spinup': 'spindle spin-up',
  'depth-levels': 'depth levels',
};

function outputDifferenceLabels(evidence: SurfacingOutputPrecisionEvidence): string {
  return evidence.affectedFields.map((field) => OUTPUT_DIFFERENCE_LABELS[field]).join(', ');
}

function artifactDifferenceLabels(
  program: Pick<SurfacingProgram, 'coverage' | 'outputPrecision'>,
): { readonly kinds: string; readonly details: string } | null {
  const kinds: string[] = [];
  const details: string[] = [];
  if (program.coverage.kind === 'nominal-gap') {
    kinds.push('nominal row coverage gaps');
    details.push(
      `largest emitted center gap ${program.coverage.maxEmittedCenterGapMm} mm exceeds ` +
        `bit diameter ${program.coverage.bitDiameterMm} mm by ${program.coverage.nominalUncutGapMm} mm`,
    );
  }
  if (program.outputPrecision !== null) {
    kinds.push('output differences');
    details.push(outputDifferenceLabels(program.outputPrecision));
  }
  return kinds.length === 0 ? null : { kinds: kinds.join(' and '), details: details.join('; ') };
}
