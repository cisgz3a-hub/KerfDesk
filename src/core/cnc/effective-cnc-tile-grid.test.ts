import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncTiling } from '../scene';
import { effectiveCncTileGrid, MAX_CNC_TILE_PLAN_COUNT } from './effective-cnc-tile-grid';

const PROPERTY_RUNS = 300;
const PROPERTY_SEED = 20_260_729;
const DISPARATE_MIN_X_MM = -2.585_891_369_023_558e291;
const DISPARATE_MAX_X_MM = 3.322_458_360_671_532e121;
const ORDINARY_TILING: CncTiling = {
  tileWidthMm: 100,
  tileHeightMm: 100,
  overlapMm: 10,
  registrationHoles: false,
};

describe('effectiveCncTileGrid', () => {
  it('preserves ordinary tile-minus-overlap geometry', () => {
    const result = effectiveCncTileGrid({ minX: 0, minY: 0, maxX: 250, maxY: 80 }, ORDINARY_TILING);

    expect(result).toEqual({
      kind: 'ready',
      grid: {
        geometry: {
          tileWidthMm: 100,
          tileHeightMm: 100,
          stepXMm: 90,
          stepYMm: 90,
          overlapMm: 10,
        },
        work: {
          columns: 3,
          rows: 1,
          exactTileCount: 3,
          budget: MAX_CNC_TILE_PLAN_COUNT,
        },
        coveredBounds: { minX: 0, minY: 0, maxX: 280, maxY: 100 },
      },
    });
  });

  it('reports over-budget work without under-covering degenerate overlap bounds', () => {
    const result = effectiveCncTileGrid(
      { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      {
        tileWidthMm: 60,
        tileHeightMm: 60,
        overlapMm: 100,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('work-budget-exceeded');
    expect(result.grid.geometry).toMatchObject({
      stepXMm: 1,
      stepYMm: 1,
      overlapMm: 59,
    });
    expect(result.grid.work).toEqual({
      columns: 341,
      rows: 341,
      exactTileCount: 116_281,
      budget: MAX_CNC_TILE_PLAN_COUNT,
    });
    expect(result.grid.coveredBounds.maxX).toBeGreaterThanOrEqual(400);
    expect(result.grid.coveredBounds.maxY).toBeGreaterThanOrEqual(400);
  });

  it('keeps a one-axis high-overlap grid when its total work fits the budget', () => {
    const result = effectiveCncTileGrid(
      { minX: 0, minY: 0, maxX: 400, maxY: 80 },
      {
        tileWidthMm: 60,
        tileHeightMm: 200,
        overlapMm: 100,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('ready');
    expect(result.grid.geometry).toEqual({
      tileWidthMm: 60,
      tileHeightMm: 200,
      stepXMm: 1,
      stepYMm: 141,
      overlapMm: 59,
    });
    expect(result.grid.work).toEqual({
      columns: 341,
      rows: 1,
      exactTileCount: 341,
      budget: MAX_CNC_TILE_PLAN_COUNT,
    });
    expect(result.grid.coveredBounds).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 200 });
  });

  it('classifies the exact budget edge before materialization', () => {
    const atBudget = effectiveCncTileGrid(
      { minX: 0, minY: 0, maxX: 500, maxY: 400 },
      {
        tileWidthMm: 20,
        tileHeightMm: 20,
        overlapMm: 0,
        registrationHoles: false,
      },
    );
    const overBudget = effectiveCncTileGrid(
      { minX: 0, minY: 0, maxX: 520, maxY: 400 },
      {
        tileWidthMm: 20,
        tileHeightMm: 20,
        overlapMm: 0,
        registrationHoles: false,
      },
    );

    expect(atBudget.kind).toBe('ready');
    expect(atBudget.grid.work.exactTileCount).toBe(MAX_CNC_TILE_PLAN_COUNT);
    expect(overBudget.kind).toBe('work-budget-exceeded');
    expect(overBudget.grid.work.exactTileCount).toBeGreaterThan(MAX_CNC_TILE_PLAN_COUNT);
  });

  it('adds a tile when floating-point division would leave the far edge uncovered', () => {
    const requiredMaximumMm = 4_103.400_000_000_001;
    const result = effectiveCncTileGrid(
      { minX: 0, minY: 0, maxX: requiredMaximumMm, maxY: 100 },
      {
        tileWidthMm: 195.4,
        tileHeightMm: 100,
        overlapMm: 0,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('ready');
    expect(result.grid.work.columns).toBe(22);
    expect(result.grid.coveredBounds.maxX).toBeGreaterThanOrEqual(requiredMaximumMm);
  });

  it('validates translated coverage when bound magnitudes differ drastically', () => {
    const tileWidthMm = DISPARATE_MAX_X_MM - DISPARATE_MIN_X_MM;
    const result = effectiveCncTileGrid(
      { minX: DISPARATE_MIN_X_MM, minY: 0, maxX: DISPARATE_MAX_X_MM, maxY: 100 },
      {
        tileWidthMm,
        tileHeightMm: 100,
        overlapMm: 0,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('ready');
    expect(result.grid.work.columns).toBe(2);
    expect(result.grid.coveredBounds.maxX).toBeGreaterThanOrEqual(DISPARATE_MAX_X_MM);
  });

  it('does not multiply astronomically large finite grid dimensions', () => {
    const result = effectiveCncTileGrid(
      { minX: 0, minY: 0, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE },
      {
        tileWidthMm: 20,
        tileHeightMm: 20,
        overlapMm: 19,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('work-budget-exceeded');
    expect(result.grid.work.exactTileCount).toBeNull();
    expect(result.grid.work.columns).toBeGreaterThan(MAX_CNC_TILE_PLAN_COUNT);
    expect(result.grid.work.rows).toBeGreaterThan(MAX_CNC_TILE_PLAN_COUNT);
    expect(Number.isFinite(result.grid.coveredBounds.maxX)).toBe(true);
    expect(Number.isFinite(result.grid.coveredBounds.maxY)).toBe(true);
  });

  it('keeps an accepted maximum-finite tile geometry materializable', () => {
    const result = effectiveCncTileGrid(
      { minX: 0, minY: 0, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE },
      {
        tileWidthMm: Number.MAX_VALUE,
        tileHeightMm: Number.MAX_VALUE,
        overlapMm: Number.MAX_VALUE,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('ready');
    expect(result.grid.geometry.stepXMm).toBeGreaterThan(0);
    expect(result.grid.geometry.stepYMm).toBeGreaterThan(0);
    expect(result.grid.work).toEqual({
      columns: 1,
      rows: 1,
      exactTileCount: 1,
      budget: MAX_CNC_TILE_PLAN_COUNT,
    });
  });

  it('keeps finite coverage metadata when opposite finite bounds overflow their span', () => {
    const result = effectiveCncTileGrid(
      { minX: -Number.MAX_VALUE, minY: -Number.MAX_VALUE, maxX: Number.MAX_VALUE, maxY: 0 },
      {
        tileWidthMm: 20,
        tileHeightMm: 20,
        overlapMm: 19,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('work-budget-exceeded');
    expect(result.grid.work.exactTileCount).toBeNull();
    expect(result.grid.coveredBounds.maxX).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(result.grid.coveredBounds.maxY)).toBe(true);
  });

  it('keeps finite positive geometry and covers generated valid grids before allocation', () => {
    fc.assert(
      fc.property(
        fc.record({
          minX: fc.double({ min: -1_000, max: 1_000, noNaN: true, noDefaultInfinity: true }),
          minY: fc.double({ min: -1_000, max: 1_000, noNaN: true, noDefaultInfinity: true }),
          width: fc.double({ min: 0, max: 2_000, noNaN: true, noDefaultInfinity: true }),
          height: fc.double({ min: 0, max: 2_000, noNaN: true, noDefaultInfinity: true }),
          tileWidthMm: fc.double({
            min: 0.001,
            max: 1_500,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          tileHeightMm: fc.double({
            min: 0.001,
            max: 1_500,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          overlapMm: fc.double({
            min: 0,
            max: 2_000,
            noNaN: true,
            noDefaultInfinity: true,
          }),
        }),
        ({ minX, minY, width, height, tileWidthMm, tileHeightMm, overlapMm }) => {
          const result = effectiveCncTileGrid(
            { minX, minY, maxX: minX + width, maxY: minY + height },
            { tileWidthMm, tileHeightMm, overlapMm, registrationHoles: false },
          );

          expect(result.grid.geometry.stepXMm).toBeGreaterThan(0);
          expect(result.grid.geometry.stepYMm).toBeGreaterThan(0);
          expect(Number.isFinite(result.grid.geometry.stepXMm)).toBe(true);
          expect(Number.isFinite(result.grid.geometry.stepYMm)).toBe(true);
          expect(result.grid.work.columns).toBeGreaterThanOrEqual(1);
          expect(result.grid.work.rows).toBeGreaterThanOrEqual(1);
          expect(result.grid.coveredBounds.maxX).toBeGreaterThanOrEqual(minX + width);
          expect(result.grid.coveredBounds.maxY).toBeGreaterThanOrEqual(minY + height);
          if (result.kind === 'ready') {
            expect(result.grid.work.exactTileCount).not.toBeNull();
            expect(result.grid.work.exactTileCount).toBeLessThanOrEqual(MAX_CNC_TILE_PLAN_COUNT);
          }
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });
});
