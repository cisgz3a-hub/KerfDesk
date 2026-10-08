import type { PartGeneratorDefinition } from './part-generator';
import { PART_GENERATOR_MAX_HOLES } from './part-generator';

export function partGeneratorProblem(definition: PartGeneratorDefinition): string | null {
  if (definition.name.trim() === '' || definition.name.length > 200)
    return 'Name the generated part using up to 200 characters.';
  if (![definition.widthMm, definition.heightMm, definition.holeDiameterMm].every(dimension))
    return 'Dimensions must be finite, positive and at most 100000 mm.';
  if (definition.kind === 'bracket') return bracketProblem(definition);
  const edgeProblem = edgeOffsetProblem(definition);
  if (edgeProblem !== null) return edgeProblem;
  if (definition.kind === 'panel') return null;
  return gridProblem(definition);
}

function bracketProblem(
  definition: Extract<PartGeneratorDefinition, { readonly kind: 'bracket' }>,
): string | null {
  if (
    !dimension(definition.legWidthMm) ||
    definition.legWidthMm >= Math.min(definition.widthMm, definition.heightMm)
  )
    return 'Bracket leg width must be smaller than the overall width and height.';
  if (
    definition.holeDiameterMm >= definition.legWidthMm ||
    !dimension(definition.holeOffsetMm) ||
    definition.holeOffsetMm <= definition.holeDiameterMm / 2 ||
    definition.holeOffsetMm >=
      Math.min(definition.widthMm, definition.heightMm) - definition.legWidthMm / 2
  )
    return 'Bracket holes must fit in each leg with a positive edge clearance.';
  return null;
}
function dimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 100000;
}
function integerCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 32;
}

function edgeOffsetProblem(
  definition: Exclude<PartGeneratorDefinition, { readonly kind: 'bracket' }>,
): string | null {
  if (
    !dimension(definition.edgeOffsetMm) ||
    definition.edgeOffsetMm <= definition.holeDiameterMm / 2
  )
    return 'The hole offset must leave each hole inside the part boundary.';
  if (
    definition.widthMm <= 2 * definition.edgeOffsetMm ||
    definition.heightMm <= 2 * definition.edgeOffsetMm
  )
    return 'Width and height must exceed twice the hole offset.';
  return null;
}

function gridProblem(
  definition: Extract<PartGeneratorDefinition, { readonly kind: 'hole-grid' | 'fixture' }>,
): string | null {
  if (
    !integerCount(definition.rows) ||
    !integerCount(definition.columns) ||
    definition.rows * definition.columns > PART_GENERATOR_MAX_HOLES
  )
    return 'Choose 1–32 rows and columns with at most 512 grid holes.';
  if (
    definition.kind === 'fixture' &&
    (!dimension(definition.mountDiameterMm) ||
      !dimension(definition.mountOffsetMm) ||
      definition.mountOffsetMm <= definition.mountDiameterMm / 2 ||
      Math.min(definition.widthMm, definition.heightMm) <= 2 * definition.mountOffsetMm)
  )
    return 'Fixture mounting holes must remain inside the boundary with a positive edge clearance.';
  return null;
}
