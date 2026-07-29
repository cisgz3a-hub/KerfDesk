import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { effectiveCncTiling } from '../../core/cnc/tiling';
import type { CncTiling } from '../../core/scene';
import { cncTilingAfterEdit, cncTilingDisclosure } from './CncTilingDisclosure';

const PROPERTY_RUNS = 200;
const PROPERTY_SEED = 20_260_729;
const tileDimensionMm = fc.double({ min: 20, max: 1500, noNaN: true });
const requestedOverlapMm = fc.double({ min: 0, max: 2000, noNaN: true });

function tiling(overlapMm: number): CncTiling {
  return {
    tileWidthMm: 100,
    tileHeightMm: 80,
    overlapMm,
    registrationHoles: false,
  };
}

describe('cncTilingDisclosure', () => {
  it('states ordinary requested overlap and both tile steps', () => {
    expect(cncTilingDisclosure(tiling(10))).toEqual({
      isAdjusted: false,
      message: 'Overlap 10 mm · tile step X 90 mm / Y 70 mm.',
    });
  });

  it('states the scalar effective overlap without rewriting the saved request', () => {
    expect(cncTilingDisclosure(tiling(100))).toEqual({
      isAdjusted: true,
      message:
        'Requested overlap 100 mm · effective overlap 79 mm · tile step X 21 mm / Y 1 mm. ' +
        'Export uses the effective overlap; the saved request is unchanged.',
    });
  });

  it('persists effective geometry only after an explicit numeric edit', () => {
    const legacy = tiling(100);

    expect(cncTilingAfterEdit(legacy, { tileHeightMm: 60 })).toEqual({
      ...legacy,
      tileHeightMm: 60,
      overlapMm: 59,
    });
    expect(cncTilingAfterEdit(legacy, { registrationHoles: true })).toEqual({
      ...legacy,
      registrationHoles: true,
    });
  });

  it('persists effective overlap after any valid numeric tile-height edit', () => {
    fc.assert(
      fc.property(
        tileDimensionMm,
        tileDimensionMm,
        tileDimensionMm,
        requestedOverlapMm,
        (tileWidthMm, tileHeightMm, editedTileHeightMm, overlapMm) => {
          const current: CncTiling = {
            tileWidthMm,
            tileHeightMm,
            overlapMm,
            registrationHoles: false,
          };
          const next = cncTilingAfterEdit(current, { tileHeightMm: editedTileHeightMm });

          expect(next.overlapMm).toBe(
            effectiveCncTiling({ ...current, tileHeightMm: editedTileHeightMm }).overlapMm,
          );
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });

  it('preserves loaded overlap after any registration-only edit', () => {
    fc.assert(
      fc.property(
        tileDimensionMm,
        tileDimensionMm,
        requestedOverlapMm,
        fc.boolean(),
        (tileWidthMm, tileHeightMm, overlapMm, registrationHoles) => {
          const current: CncTiling = {
            tileWidthMm,
            tileHeightMm,
            overlapMm,
            registrationHoles: !registrationHoles,
          };

          expect(cncTilingAfterEdit(current, { registrationHoles }).overlapMm).toBe(overlapMm);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });

  it('does not present accepted tiny positive legacy geometry as zero', () => {
    expect(
      cncTilingDisclosure({
        tileWidthMm: 0.0001,
        tileHeightMm: 0.0001,
        overlapMm: 0,
        registrationHoles: false,
      }).message,
    ).toBe('Overlap 0 mm · tile step X 1e-4 mm / Y 1e-4 mm.');
  });
});
