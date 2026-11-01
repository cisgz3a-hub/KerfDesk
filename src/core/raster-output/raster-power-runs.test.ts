import { describe, expect, it } from 'vitest';
import {
  forEachRasterRunLostToDotWidthCorrection,
  rasterPixelRuns,
  rasterSweepRunsForPixelRuns,
  type RasterPixelRun,
  type RasterRunGeometry,
  type RasterSweepRun,
} from './raster-power-runs';

const UNIT: RasterRunGeometry = {
  pixelWidthMm: 1,
  isReverse: false,
  dotWidthCorrectionMm: 0.25,
  minXWorldMm: 0,
};

function sweep(row: ReadonlyArray<number>, geometry: Partial<RasterRunGeometry> = {}) {
  const runs = rasterPixelRuns(Float64Array.from(row), { firstX: 0, lastX: row.length - 1 });
  const isReverse = geometry.isReverse ?? false;
  return rasterSweepRunsForPixelRuns({
    ...UNIT,
    ...geometry,
    runs: isReverse ? [...runs].reverse() : runs,
  });
}

function lost(row: ReadonlyArray<number>, geometry: Partial<RasterRunGeometry> = {}) {
  const ranges: Array<readonly [number, number]> = [];
  const hasPower = forEachRasterRunLostToDotWidthCorrection(
    Float64Array.from(row),
    { ...UNIT, ...geometry },
    (firstX, endX) => ranges.push([firstX, endX]),
  );
  return { hasPower, ranges };
}

function move(startXWorldMm: number, endXWorldMm: number, s: number): RasterSweepRun {
  return { startXWorldMm, endXWorldMm, s };
}

// The trim before ADR-458 Amendment 1: every exact-power run on its own.
function perRunTrim(run: RasterPixelRun, geometry: RasterRunGeometry): RasterSweepRun[] {
  const { pixelWidthMm, isReverse, dotWidthCorrectionMm: dwc, minXWorldMm } = geometry;
  const leftX = minXWorldMm + run.firstX * pixelWidthMm;
  const rightX = minXWorldMm + (run.lastX + 1) * pixelWidthMm;
  const startX = isReverse ? rightX : leftX;
  const endX = isReverse ? leftX : rightX;
  if (run.s <= 0 || dwc <= 0) return [move(startX, endX, run.s)];
  const burnStartX = startX + (isReverse ? -dwc : dwc);
  const burnEndX = endX + (isReverse ? dwc : -dwc);
  const survives = isReverse ? burnStartX > burnEndX : burnStartX < burnEndX;
  if (!survives) return [move(startX, endX, 0)];
  return [move(startX, burnStartX, 0), move(burnStartX, burnEndX, run.s), move(burnEndX, endX, 0)];
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('raster power runs', () => {
  it('splits exact S values without merging adjacent grayscale power', () => {
    expect(rasterPixelRuns(Uint16Array.of(1000, 608, 0), { firstX: 0, lastX: 2 })).toEqual([
      { firstX: 0, lastX: 0, s: 1000 },
      { firstX: 1, lastX: 1, s: 608 },
      { firstX: 2, lastX: 2, s: 0 },
    ]);
  });

  it('preserves historical coordinate ordering at the controller boundary', () => {
    expect(
      rasterSweepRunsForPixelRuns({
        runs: [{ firstX: 0, lastX: 0, s: 500 }],
        pixelWidthMm: 0.041667,
        isReverse: false,
        dotWidthCorrectionMm: 0.0207,
        minXWorldMm: 1,
      }),
    ).toEqual([move(1, 1.0207, 0), move(1.0207, 1.020967, 500), move(1.020967, 1.041667, 0)]);
  });
});

describe('Dot Width Correction shortens burned lines (ADR-458 Amendment 1)', () => {
  it('trims only where the beam turns on and off, never a change between two powers', () => {
    expect(sweep([1000, 608, 300])).toEqual([
      move(0, 0.25, 0),
      move(0.25, 1, 1000),
      move(1, 2, 608),
      move(2, 2.75, 300),
      move(2.75, 3, 0),
    ]);
    expect(sweep([1000, 608, 300], { isReverse: true })).toEqual([
      move(3, 2.75, 0),
      move(2.75, 2, 300),
      move(2, 1, 608),
      move(1, 0.25, 1000),
      move(0.25, 0, 0),
    ]);
  });

  it('trims each burned line on its own across a dark gap', () => {
    expect(sweep([500, 500, 0, 700, 300])).toEqual([
      move(0, 0.25, 0),
      move(0.25, 1.75, 500),
      move(1.75, 2, 0),
      move(2, 3, 0),
      move(3, 3.25, 0),
      move(3.25, 4, 700),
      move(4, 4.75, 300),
      move(4.75, 5, 0),
    ]);
  });

  it('lets an end trim pass over a run narrower than the correction', () => {
    expect(sweep([1000, 500, 500, 500], { dotWidthCorrectionMm: 1.5 })).toEqual([
      move(0, 1.5, 0),
      move(1.5, 2.5, 500),
      move(2.5, 4, 0),
    ]);
  });

  it('turns a burned line the correction removes into one dark move', () => {
    expect(sweep([1000, 500], { dotWidthCorrectionMm: 1 })).toEqual([move(0, 2, 0)]);
  });

  it('leaves every run whole without a correction', () => {
    expect(sweep([1000, 608, 0], { dotWidthCorrectionMm: 0 })).toEqual([
      move(0, 1, 1000),
      move(1, 2, 608),
      move(2, 3, 0),
    ]);
  });

  it('keeps the per-run trim, move for move, on rows of full power or nothing', () => {
    const random = seededRandom(458);
    for (let trial = 0; trial < 400; trial += 1) {
      const width = 1 + Math.floor(random() * 40);
      const density = random();
      const row = Array.from({ length: width }, () => (random() < density ? 1000 : 0));
      const geometry: RasterRunGeometry = {
        pixelWidthMm: [0.1, 0.0847, 0.041667, 0.25][trial % 4] ?? 0.1,
        isReverse: trial % 2 === 1,
        dotWidthCorrectionMm: [0.0005, 0.02, 0.0207, 0.05, 0.1][trial % 5] ?? 0.02,
        minXWorldMm: [0, 1.37, -3.21][trial % 3] ?? 0,
      };
      const runs = rasterPixelRuns(Float64Array.from(row), { firstX: 0, lastX: width - 1 });
      const ordered = geometry.isReverse ? [...runs].reverse() : runs;
      expect(rasterSweepRunsForPixelRuns({ ...geometry, runs: ordered })).toEqual(
        ordered.flatMap((run) => perRunTrim(run, geometry)),
      );
    }
  });

  it('reports runs that keep no burn, in either scan direction', () => {
    const row = [0, 1000, 0, 1000, 500, 500, 700, 0];
    for (const isReverse of [false, true]) {
      expect(lost(row, { isReverse, dotWidthCorrectionMm: 0.75 })).toEqual({
        hasPower: true,
        ranges: [[1, 2]],
      });
      expect(lost(row, { isReverse, dotWidthCorrectionMm: 1.25 })).toEqual({
        hasPower: true,
        ranges: [
          [1, 2],
          [3, 4],
          [6, 7],
        ],
      });
    }
  });

  it('reports nothing for a dark row or without a correction', () => {
    expect(lost([0, 0, 0])).toEqual({ hasPower: false, ranges: [] });
    expect(lost([1000, 0, 608], { dotWidthCorrectionMm: 0 })).toEqual({
      hasPower: true,
      ranges: [],
    });
  });
});
