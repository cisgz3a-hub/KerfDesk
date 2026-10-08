import { describe, expect, it } from 'vitest';
import { nestRotation } from './quick-nest';
import { planProductionNest, searchProductionNest } from './production-nest-plan';
import { productionFixture } from './production-nest.test-fixture';
import { validateProductionNest } from './production-nest-validation';
import { parseProductionNestDefinition } from '../../io/project/project-production-nest-validator';

describe('quantity and grain aware production placement', () => {
  it('conserves quantities across declared sheets and remnants with deterministic gap and area accounting', () => {
    const input = productionFixture();
    const result = planProductionNest(input);
    expect(result).toEqual(planProductionNest(input));
    expect(result).toMatchObject({
      requested: 6,
      produced: 6,
      unplaced: 0,
      stockAreaMm2: 2392,
      occupiedAreaMm2: 1200,
      vectorLengthMm: 360,
    });
    expect(result.sheets.map((sheet) => sheet.placements.length)).toEqual([4, 2]);
    expect(result.stockUtilisationPercent).toBeCloseTo(50.16722);
    expect(result.placementTravelMm).toBeGreaterThan(0);
    expect(validateProductionNest(input, result)).toBe(true);
  });
  it('accounts for every unplaced copy and distinguishes missing artwork, stock compatibility, grain and fit', () => {
    const input = productionFixture();
    const stock = input.definition.sheets[0]!;
    const base = input.definition.parts[0]!;
    const parts = [
      { ...base, id: 'missing', quantity: 1 },
      { ...base, id: 'material', materialKey: 'Oak', quantity: 1 },
      { ...base, id: 'thickness', thicknessMm: 12, quantity: 1 },
      { ...base, id: 'grain', grain: 'x' as const, quantity: 1 },
      { ...base, id: 'large', quantity: 1 },
    ];
    const geometry = parts.slice(1).map((part) => ({
      partId: part.id,
      item: { id: part.id, width: part.id === 'large' ? 100 : 20, height: 10, canRotate: false },
      vectorLengthMm: 60,
    }));
    const result = planProductionNest({
      definition: { ...input.definition, parts, sheets: [stock] },
      geometry,
    });
    expect(result).toMatchObject({ requested: 5, produced: 0, unplaced: 5 });
    expect(result.quantities.map((quantity) => quantity.reason)).toEqual([
      expect.stringContaining('missing'),
      expect.stringContaining('material and thickness'),
      expect.stringContaining('material and thickness'),
      expect.stringContaining('grain'),
      expect.stringContaining('space'),
    ]);
  });
  it('turns only where part and stock grain agree and verifies the actual turn independently', () => {
    const input = productionFixture();
    const part = {
      ...input.definition.parts[0]!,
      quantity: 1,
      grain: 'x' as const,
      rotationAngles: [0, 90] as const,
    };
    const stock = {
      ...input.definition.sheets[0]!,
      grain: 'y' as const,
      widthMm: 14,
      heightMm: 24,
    };
    const constrained = {
      ...input,
      definition: { ...input.definition, parts: [part], sheets: [stock] },
    };
    const result = planProductionNest(constrained);
    expect(result.produced).toBe(1);
    expect(nestRotation(result.sheets[0]!.placements[0]!)).toBe(90);
    const wrong = {
      ...result,
      sheets: result.sheets.map((sheet) => ({
        ...sheet,
        placements: sheet.placements.map((placement) => ({
          ...placement,
          rotationDeg: 0 as const,
          rotated90: false,
        })),
      })),
    };
    expect(validateProductionNest(constrained, wrong)).toBe(false);
  });
  it('rejects invented totals, duplicate copy identity, overlaps and boundary escapes', () => {
    const input = productionFixture();
    const result = planProductionNest(input);
    expect(validateProductionNest(input, { ...result, produced: 5 })).toBe(false);
    for (const patch of [{ id: 'panel:1' }, { x: 1, y: 1 }, { x: -1 }]) {
      const broken = {
        ...result,
        sheets: result.sheets.map((sheet, index) =>
          index === 0
            ? {
                ...sheet,
                placements: sheet.placements.map((placement, position) =>
                  position === 1 ? { ...placement, ...patch } : placement,
                ),
              }
            : sheet,
        ),
      };
      expect(validateProductionNest(input, broken)).toBe(false);
    }
  });
  it('retains the best valid draft during a bounded deterministic search', () => {
    const input = productionFixture();
    const progress = [
      ...searchProductionNest({ ...input, definition: { ...input.definition, optimise: true } }),
    ];
    expect(progress).toHaveLength(24);
    expect(
      progress.every((step) => step.best !== null && validateProductionNest(input, step.best)),
    ).toBe(true);
    expect(progress.at(-1)?.best?.produced).toBe(6);
  });
  it('bounds quantities and rejects duplicate source or output identities at persistence boundaries', () => {
    const { definition } = productionFixture();
    expect(parseProductionNestDefinition(undefined)).toEqual({ kind: 'ok', value: undefined });
    expect(parseProductionNestDefinition(definition).kind).toBe('ok');
    expect(
      parseProductionNestDefinition({
        ...definition,
        parts: [{ ...definition.parts[0], quantity: 10001 }],
      }).kind,
    ).toBe('invalid');
    expect(
      parseProductionNestDefinition({
        ...definition,
        parts: [{ ...definition.parts[0], objectIds: ['source', 'source'] }],
      }).kind,
    ).toBe('invalid');
    expect(
      parseProductionNestDefinition({
        ...definition,
        output: { sheetId: 'missing', instances: [] },
      }).kind,
    ).toBe('invalid');
    expect(() =>
      planProductionNest({
        ...productionFixture(),
        definition: { ...definition, parts: [{ ...definition.parts[0]!, quantity: 10001 }] },
      }),
    ).toThrow('10000');
  });
});
