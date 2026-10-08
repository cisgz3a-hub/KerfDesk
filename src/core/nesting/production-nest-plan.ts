import { describeNestLayout, layoutNest, type NestingInput, type NestLayout } from './layout-nest';
import { quickNest, type NestRotation } from './quick-nest';
import {
  productionPartRotations,
  productionStockCompatible,
} from './production-nest-compatibility';
import { describeProductionNest } from './production-nest-metrics';
import type {
  ProductionNestPlacement,
  ProductionNestResult,
  ProductionNestSheetLayout,
  ProductionNestStock,
  ProductionNestingInput,
  ProductionNestingProgress,
} from './production-nest';
import { validateProductionNest } from './production-nest-validation';

export type ProductionNestCopy = {
  readonly partId: string;
  readonly copyIndex: number;
  readonly id: string;
};
export function productionNestCopies(input: ProductionNestingInput): ProductionNestCopy[] {
  return input.definition.parts.flatMap((part) =>
    Array.from({ length: part.quantity }, (_, copyIndex) => ({
      partId: part.id,
      copyIndex,
      id: part.id + ':' + (copyIndex + 1),
    })),
  );
}
export function* searchProductionNest(
  input: ProductionNestingInput,
): Generator<ProductionNestingProgress> {
  const total = input.definition.optimise ? 24 : 1;
  let best: ProductionNestResult | null = null;
  for (let trial = 0; trial < total; trial += 1) {
    const candidate = planProductionNest(input, trial);
    if (
      best === null ||
      candidate.produced > best.produced ||
      (candidate.produced === best.produced && footprint(candidate) < footprint(best))
    )
      best = candidate;
    yield { attempted: trial + 1, total, best };
  }
}
export function planProductionNest(input: ProductionNestingInput, trial = 0): ProductionNestResult {
  assertProductionNestInput(input);
  let remaining = productionNestCopies(input);
  const sheets: ProductionNestSheetLayout[] = [];
  for (const stock of input.definition.sheets) {
    const candidate = nestProductionSheet(input, stock, remaining, trial);
    if (candidate === null) continue;
    sheets.push(candidate);
    const placed = new Set(candidate.placements.map((placement) => placement.id));
    remaining = remaining.filter((copy) => !placed.has(copy.id));
  }
  const result = describeProductionNest(input, sheets);
  if (!validateProductionNest(input, result))
    throw new Error(
      'Production nest failed independent containment, collision or quantity validation.',
    );
  return result;
}
export function productionSheetInput(
  input: ProductionNestingInput,
  stock: ProductionNestStock,
  copies: ReadonlyArray<ProductionNestCopy>,
): NestingInput {
  const items = copies.flatMap((copy) => {
    const part = input.definition.parts.find((part) => part.id === copy.partId);
    const geometry = input.geometry.find((geometry) => geometry.partId === copy.partId);
    if (part === undefined || geometry === undefined || !productionStockCompatible(part, stock))
      return [];
    const rotationAngles = productionPartRotations(part, stock);
    return rotationAngles.length === 0
      ? []
      : [
          {
            ...geometry.item,
            id: copy.id,
            rotationAngles,
            canRotate: rotationAngles.some((angle) => angle !== 0),
          },
        ];
  });
  return {
    bin: { minX: 0, minY: 0, maxX: stock.widthMm, maxY: stock.heightMm },
    items,
    padding: input.definition.padding,
    goal: input.definition.goal,
    method: input.definition.method,
    optimise: false,
  };
}
function nestProductionSheet(
  input: ProductionNestingInput,
  stock: ProductionNestStock,
  copies: ReadonlyArray<ProductionNestCopy>,
  trial: number,
): ProductionNestSheetLayout | null {
  const original = productionSheetInput(input, stock, copies);
  if (original.items.length === 0) return null;
  const complete = layoutNest(original, trial);
  if (complete !== null) return identifyProductionLayout(complete, stock, copies);
  const first = quickNest(original.bin, original.items, original);
  const unplaced = new Set(first.ok ? [] : first.unplacedIds);
  const accepted = { ...original, items: original.items.filter((item) => !unplaced.has(item.id)) };
  if (accepted.items.length === 0) return null;
  const compact = layoutNest(accepted, trial);
  const rectangles = quickNest(accepted.bin, accepted.items, accepted);
  if (!rectangles.ok) return null;
  const layout = compact ?? describeNestLayout(accepted, rectangles.placements, false);
  return identifyProductionLayout(layout, stock, copies);
}
function identifyProductionLayout(
  layout: NestLayout,
  stock: ProductionNestStock,
  copies: ReadonlyArray<ProductionNestCopy>,
): ProductionNestSheetLayout {
  const byId = new Map(copies.map((copy) => [copy.id, copy]));
  const placements = layout.placements.flatMap((placement): ProductionNestPlacement[] => {
    const copy = byId.get(placement.id);
    return copy === undefined
      ? []
      : [{ ...placement, partId: copy.partId, copyIndex: copy.copyIndex }];
  });
  return { ...layout, sheetId: stock.id, placements };
}
function footprint(result: ProductionNestResult): number {
  return result.sheets.reduce((area, sheet) => area + sheet.footprintAreaMm2, 0);
}
export function productionRotationAngle(value: number): NestRotation | null {
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null;
}
function assertProductionNestInput(input: ProductionNestingInput): void {
  const parts = input.definition.parts;
  const copies = parts.reduce((total, part) => total + part.quantity, 0);
  if (
    parts.length > 1000 ||
    input.definition.sheets.length > 99 ||
    !Number.isInteger(copies) ||
    copies > 10000 ||
    parts.some((part) => !Number.isInteger(part.quantity) || part.quantity < 1)
  )
    throw new Error('Quantity nesting supports up to 10000 declared copies and 99 sheets.');
  if (
    input.geometry.some(
      (geometry) =>
        !Number.isFinite(geometry.item.width + geometry.item.height + geometry.vectorLengthMm) ||
        geometry.item.width <= 0 ||
        geometry.item.height <= 0,
    )
  )
    throw new Error('A part has unusable geometry dimensions.');
}
