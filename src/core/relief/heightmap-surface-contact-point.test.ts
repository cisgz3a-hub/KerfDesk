import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { partialCellCenter } from '../grid';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import {
  densestSample,
  oracleContact,
  triangulatedSurface,
} from './heightmap-surface-contact-oracle.test-support';

// ADR-423: waterline finishing asks for the exact contact of a cutter centred
// anywhere, not only on a sample.

const TOOLS: ReadonlyArray<CncTool> = [
  { id: 'flat', name: 'flat', kind: 'end-mill', diameterMm: 1.4 },
  { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 1.4 },
  { id: 'v', name: 'v-bit', kind: 'v-bit', diameterMm: 1.4, tipAngleDeg: 60 },
  {
    id: 'tapered',
    name: 'tapered ball',
    kind: 'tapered-ball-nose',
    diameterMm: 1.4,
    tipDiameterMm: 0.5,
    tipAngleDeg: 30,
  },
];
const WIDTH = 6;
const HEIGHT = 5;
const CELL_MM = 0.5;
const TOLERANCE_MM = 3e-6;

const MAPS = fc.record({
  depths: fc.array(fc.integer({ min: -6_000, max: 0 }), {
    minLength: WIDTH * HEIGHT,
    maxLength: WIDTH * HEIGHT,
  }),
  mask: fc.option(
    fc.array(fc.boolean(), { minLength: WIDTH * HEIGHT, maxLength: WIDTH * HEIGHT }),
    { nil: undefined },
  ),
  partial: fc.boolean(),
});

function mapFrom(input: {
  readonly depths: ReadonlyArray<number>;
  readonly mask: ReadonlyArray<boolean> | undefined;
  readonly partial: boolean;
}): Heightmap {
  return {
    widthCells: WIDTH,
    heightCells: HEIGHT,
    widthMm: input.partial ? 2.825 : WIDTH * CELL_MM,
    heightMm: input.partial ? 2.2 : HEIGHT * CELL_MM,
    mmPerCell: CELL_MM,
    depth: Float32Array.from(input.depths, (depth) => depth / 1_000),
    ...(input.mask === undefined
      ? {}
      : { inclusion: Uint8Array.from(input.mask, (isIn) => (isIn ? 1 : 0)) }),
  };
}

describe('surface contact at any point (ADR-423)', () => {
  it.each(TOOLS)('agrees with the sample query on every sample ($kind)', (tool) => {
    fc.assert(
      fc.property(MAPS, (input) => {
        const map = mapFrom(input);
        const field = createSurfaceContactField(map, kernelForTool(tool, CELL_MM));
        if (field === null) return;
        for (let cy = 0; cy < HEIGHT; cy += 1) {
          for (let cx = 0; cx < WIDTH; cx += 1) {
            const x = partialCellCenter(map, 'x', cx);
            const y = partialCellCenter(map, 'y', cy);
            const atSample = field.constraint(cx, cy, Number.NEGATIVE_INFINITY);
            const atPoint = field.constraintAtPoint(x, y, Number.NEGATIVE_INFINITY);
            if (atSample === Number.NEGATIVE_INFINITY) expect(atPoint).toBe(atSample);
            else expect(Math.abs(atPoint - atSample)).toBeLessThanOrEqual(1e-9);
          }
        }
      }),
      { numRuns: 20 },
    );
  });

  it.each(TOOLS)('matches the oracle between samples and beyond the map ($kind)', (tool) => {
    const point = fc.record({
      x: fc.double({ min: -0.8, max: WIDTH * CELL_MM + 0.8, noNaN: true }),
      y: fc.double({ min: -0.8, max: HEIGHT * CELL_MM + 0.8, noNaN: true }),
    });
    fc.assert(
      fc.property(MAPS, fc.array(point, { minLength: 1, maxLength: 12 }), (input, points) => {
        const map = mapFrom(input);
        const kernel = kernelForTool(tool, CELL_MM);
        const field = createSurfaceContactField(map, kernel);
        if (field === null) return;
        const surface = triangulatedSurface(map);
        for (const { x, y } of points) {
          const actual = field.constraintAtPoint(x, y, Number.NEGATIVE_INFINITY);
          const expected = oracleContact(kernel, surface, x, y);
          if (expected === Number.NEGATIVE_INFINITY) {
            expect(actual).toBe(Number.NEGATIVE_INFINITY);
            continue;
          }
          expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE_MM);
          expect(densestSample(kernel, surface, x, y)).toBeLessThanOrEqual(actual + TOLERANCE_MM);
        }
      }),
      { numRuns: 12 },
    );
  });

  it.each(TOOLS)('answers "does it clear z" exactly as the height does ($kind)', (tool) => {
    const query = fc.record({
      x: fc.double({ min: -0.8, max: WIDTH * CELL_MM + 0.8, noNaN: true }),
      y: fc.double({ min: -0.8, max: HEIGHT * CELL_MM + 0.8, noNaN: true }),
      z: fc.double({ min: -7, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(MAPS, fc.array(query, { minLength: 1, maxLength: 20 }), (input, queries) => {
        const field = createSurfaceContactField(mapFrom(input), kernelForTool(tool, CELL_MM));
        if (field === null) return;
        for (const { x, y, z } of queries) {
          const height = field.constraintAtPoint(x, y, Number.NEGATIVE_INFINITY);
          expect(field.clearsAtPoint(x, y, z, 1e-6)).toBe(height <= z + 1e-6);
          if (height === Number.NEGATIVE_INFINITY) continue;
          // Either side of the slack, where a pruning slip would show.
          expect(field.clearsAtPoint(x, y, height - 0.5e-6, 1e-6)).toBe(true);
          expect(field.clearsAtPoint(x, y, height - 2e-6, 1e-6)).toBe(false);
        }
      }),
      { numRuns: 20 },
    );
  });
});
