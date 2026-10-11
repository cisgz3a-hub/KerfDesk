import {
  areaD,
  booleanOpDWithPolyTree,
  ClipType,
  FillRule,
  PolyTreeD,
  type PathD,
  type PolyPathD,
} from 'clipper2-ts';
import { describeNestLayout } from './layout-nest';
import { rectangleOutline, validOutline } from './nest-outline-geometry';
import {
  productionPartRotations,
  productionStockCompatible,
} from './production-nest-compatibility';
import { describeProductionNest } from './production-nest-metrics';
import { productionNestCopies, productionSheetInput } from './production-nest-plan';
import { validateProductionNest } from './production-nest-validation';
import type {
  ProductionNestingInput,
  ProductionNestResult,
  ProductionNestPlacement,
} from './production-nest';
import type { NestRotation } from './quick-nest';

export type AdvancedNestRequest =
  | { readonly kind: 'ready'; readonly instance: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Deliberately bounded: the existing planner remains available for other declarations. */
export function prepareAdvancedNest(input: ProductionNestingInput): AdvancedNestRequest {
  const { definition, geometry } = input;
  const stock = definition.sheets[0];
  const unavailable = (reason: string): AdvancedNestRequest => ({ kind: 'unavailable', reason });
  if (definition.goal !== 'compact' || definition.method !== 'outline')
    return unavailable(
      'Advanced optimisation needs Compact and Closed outlines. The standard draft is retained.',
    );
  if (stock === undefined || definition.parts.length === 0)
    return unavailable('Declare parts and stock before advanced optimisation.');
  if (
    definition.sheets.some(
      (s) =>
        s.grain !== stock.grain ||
        s.materialKey.trim().toLowerCase() !== stock.materialKey.trim().toLowerCase() ||
        Math.abs(s.thicknessMm - stock.thicknessMm) > 1e-6,
    ) ||
    definition.parts.some(
      (p) => !productionStockCompatible(p, stock) || productionPartRotations(p, stock).length === 0,
    )
  )
    return unavailable(
      'Advanced optimisation needs matching material, thickness and stock grain. The standard draft is retained.',
    );
  const copies = definition.parts.reduce((sum, p) => sum + p.quantity, 0);
  const points = definition.parts.reduce(
    (sum, p) =>
      sum +
      p.quantity *
        (geometry
          .find((g) => g.partId === p.id)
          ?.item.outline?.reduce((n, path) => n + path.length, 0) ?? 4),
    0,
  );
  if (copies > 500 || points > 50_000)
    return unavailable(
      'This layout exceeds the advanced search work budget. The standard draft is retained.',
    );
  try {
    const item_types = definition.parts.map((part) => prepareItem(input, part));
    return {
      kind: 'ready',
      instance: JSON.stringify({
        objective: 'BinPacking',
        parameters: { item_item_minimum_spacing: definition.padding },
        bin_types: definition.sheets.map((sheet) => ({
          ...shape(rectangleOutline(sheet.widthMm, sheet.heightMm)[0] ?? []),
          copies: 1,
          item_bin_minimum_spacing: definition.padding / 2,
        })),
        item_types,
      }),
    };
  } catch {
    return unavailable(
      'The advanced engine could not read these contours. The standard draft is retained.',
    );
  }
}

function prepareItem(
  input: ProductionNestingInput,
  part: ProductionNestingInput['definition']['parts'][number],
): object {
  const { geometry } = input;
  const stock = input.definition.sheets[0];
  if (stock === undefined) throw new Error('Missing stock');
  const item = geometry.find((g) => g.partId === part.id)?.item;
  if (item === undefined) throw new Error('A declared part has no geometry.');
  const outline = validOutline(item.outline)
    ? item.outline
    : rectangleOutline(item.width, item.height);
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(
    ClipType.Union,
    outline.map((path) => path.map((p) => ({ ...p }))),
    null,
    tree,
    FillRule.NonZero,
    6,
  );
  const shapes: unknown[] = [];
  visitSolids(tree, shapes);
  if (shapes.length === 0) throw new Error('A part has no closed occupied region.');
  return {
    copies: part.quantity,
    shapes,
    allowed_rotations: productionPartRotations(part, stock).map((angle) => ({
      start: angle,
      end: angle,
      mirror: false,
    })),
  };
}

function visitSolids(node: PolyPathD, shapes: unknown[]): void {
  for (let i = 0; i < node.count; i += 1) {
    const child = node.child(i);
    if (!child.isHole && child.poly !== null) {
      const holes = [];
      for (let j = 0; j < child.count; j += 1) {
        const hole = child.child(j);
        if (hole.isHole && hole.poly !== null) holes.push(shape(hole.poly));
      }
      shapes.push({ ...shape(child.poly), holes });
    }
    visitSolids(child, shapes);
  }
}
function shape(path: ReadonlyArray<{ readonly x: number; readonly y: number }>): object {
  const points = areaD(path as PathD) > 0 ? [...path] : [...path].reverse();
  return {
    type: 'general',
    elements: points.map((start, i) => ({
      type: 'LineSegment',
      start,
      end: points[(i + 1) % points.length],
    })),
  };
}

/** Treat solver output as untrusted placements: rebuild totals and prove declarations independently. */
export function readAdvancedNest(
  input: ProductionNestingInput,
  certificate: string,
): ProductionNestResult | null {
  try {
    const data: unknown = JSON.parse(certificate);
    if (
      !record(data) ||
      !Array.isArray(data.bins) ||
      data.bins.length > input.definition.sheets.length
    )
      return null;
    const copyCounts = new Map<string, number>();
    const usedStocks = new Set<number>();
    const copies = productionNestCopies(input);
    const sheets = data.bins.map((raw) => {
      if (
        !record(raw) ||
        !integer(raw.id) ||
        raw.copies !== 1 ||
        !Array.isArray(raw.items) ||
        raw.items.length === 0 ||
        usedStocks.has(raw.id)
      )
        throw new Error('Invalid sheet');
      usedStocks.add(raw.id);
      const stock = input.definition.sheets[raw.id];
      if (stock === undefined) throw new Error('Unknown stock');
      const placements: ProductionNestPlacement[] = raw.items.map((value) => {
        if (!validPlacement(value)) throw new Error('Invalid placement');
        const part = input.definition.parts[value.id];
        const item = input.geometry.find((g) => g.partId === part?.id)?.item;
        if (part === undefined || item === undefined) throw new Error('Unknown part');
        const copyIndex = copyCounts.get(part.id) ?? 0;
        if (copyIndex >= part.quantity) throw new Error('Too many copies');
        copyCounts.set(part.id, copyIndex + 1);
        const angle = value.angle as NestRotation;
        return {
          id: part.id + ':' + (copyIndex + 1),
          partId: part.id,
          copyIndex,
          x: value.x - (angle === 90 ? item.height : angle === 180 ? item.width : 0),
          y: value.y - (angle === 180 ? item.height : angle === 270 ? item.width : 0),
          rotated90: angle % 180 !== 0,
          rotationDeg: angle,
        };
      });
      const ids = new Set(placements.map((p) => p.id));
      const layoutInput = productionSheetInput(
        input,
        stock,
        copies.filter((c) => ids.has(c.id)),
      );
      return {
        ...describeNestLayout(layoutInput, placements, true),
        sheetId: stock.id,
        placements,
      };
    });
    const result = describeProductionNest(input, sheets);
    return validateProductionNest(input, result) ? result : null;
  } catch {
    return null;
  }
}

export function advancedNestImproves(
  candidate: ProductionNestResult,
  best: ProductionNestResult | null,
): boolean {
  if (best === null || candidate.produced !== best.produced)
    return best === null || candidate.produced > best.produced;
  if (candidate.sheets.length !== best.sheets.length)
    return candidate.sheets.length < best.sheets.length;
  if (candidate.stockAreaMm2 !== best.stockAreaMm2)
    return candidate.stockAreaMm2 < best.stockAreaMm2;
  return (
    candidate.sheets.reduce((n, s) => n + s.footprintAreaMm2, 0) <
    best.sheets.reduce((n, s) => n + s.footprintAreaMm2, 0)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function integer(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0;
}

function validPlacement(
  value: unknown,
): value is { id: number; x: number; y: number; angle: NestRotation; mirror: false } {
  return (
    record(value) &&
    integer(value.id) &&
    value.mirror === false &&
    finite(value.x) &&
    finite(value.y) &&
    [0, 90, 180, 270].includes(value.angle as number)
  );
}
