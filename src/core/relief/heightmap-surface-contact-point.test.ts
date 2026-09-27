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

// A tilted plane with one straight step: the contact lies exactly on the
// facet planes here, which random samples almost never do.
const SMOOTH_MAPS = fc
  .record({
    gx: fc.double({ min: -1.5, max: 1.5, noNaN: true }),
    gy: fc.double({ min: -1.5, max: 1.5, noNaN: true }),
    stepAtMm: fc.double({ min: 0, max: WIDTH * CELL_MM, noNaN: true }),
    stepMm: fc.double({ min: -2, max: 2, noNaN: true }),
    partial: fc.boolean(),
  })
  .map(({ gx, gy, stepAtMm, stepMm, partial }) => {
    const depths = Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
      const x = ((index % WIDTH) + 0.5) * CELL_MM;
      const y = (Math.floor(index / WIDTH) + 0.5) * CELL_MM;
      return 1_000 * (-3 + gx * (x - 1.5) + gy * (y - 1.25) + (x > stepAtMm ? stepMm : 0));
    });
    return mapFrom({ depths, mask: undefined, partial });
  });

const SMOOTH_OR_ROUGH_MAPS = fc.oneof(SMOOTH_MAPS, MAPS.map(mapFrom));

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

  it.each(TOOLS)('keeps every element that can rise above a move ($kind)', (tool) => {
    // ADR-421 Amendment 1: finishing solves only the elements alongMove keeps,
    // so wherever the contact rises past the move plus the tolerance, those
    // elements must give the same height every element does.
    const end = fc.record({
      x: fc.double({ min: -0.8, max: WIDTH * CELL_MM + 0.8, noNaN: true }),
      y: fc.double({ min: -0.8, max: HEIGHT * CELL_MM + 0.8, noNaN: true }),
      // Height above (or below) the contact at that end: mostly on it, as a
      // finishing path runs.
      above: fc.oneof(
        fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        fc.double({ min: -0.003, max: 0.003, noNaN: true }),
      ),
    });
    const move = fc.record({ from: end, to: end, toleranceMm: fc.constantFrom(0.001, 0.05) });
    fc.assert(
      fc.property(
        SMOOTH_OR_ROUGH_MAPS,
        fc.array(move, { minLength: 1, maxLength: 6 }),
        (map, moves) => {
          const field = createSurfaceContactField(map, kernelForTool(tool, CELL_MM));
          if (field === null) return;
          const onContact = (p: { x: number; y: number; above: number }) => {
            const tip = field.constraintAtPoint(p.x, p.y, Number.NEGATIVE_INFINITY);
            return { x: p.x, y: p.y, z: (tip === Number.NEGATIVE_INFINITY ? -3 : tip) + p.above };
          };
          for (const { toleranceMm, ...ends } of moves) {
            const from = onContact(ends.from);
            const to = onContact(ends.to);
            const kept = field.alongMove(from, to, toleranceMm);
            for (let step = 0; step <= 16; step += 1) {
              const t = step / 16;
              const x = from.x + t * (to.x - from.x);
              const y = from.y + t * (to.y - from.y);
              const bound = from.z + t * (to.z - from.z) + toleranceMm;
              const all = field.constraintAtPoint(x, y, bound);
              const some = kept === null ? bound : kept(x, y, bound);
              if (all > bound + TOLERANCE_MM)
                expect(Math.abs(some - all)).toBeLessThanOrEqual(TOLERANCE_MM);
              else expect(some).toBeLessThanOrEqual(bound + TOLERANCE_MM);
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it.each(TOOLS)('keeps the far side of a ridge a short move crosses ($kind)', (tool) => {
    // Two planes meeting at a ridge: each one, extended, rises above the
    // other's side, so a move that crosses the ridge keeps both. A move short
    // enough keeps them only by the tolerance, where a slip would show.
    const depths = Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
      const x = ((index % WIDTH) + 0.5) * CELL_MM;
      return 1_000 * (-3 - 0.8 * Math.abs(x - 1.5));
    });
    const field = createSurfaceContactField(
      mapFrom({ depths, mask: undefined, partial: false }),
      kernelForTool(tool, CELL_MM),
    );
    if (field === null) throw new Error('expected a contact field');
    const onContact = (x: number, y: number) => ({
      x,
      y,
      z: field.constraintAtPoint(x, y, Number.NEGATIVE_INFINITY),
    });
    for (let middle = 0.9; middle <= 2.1; middle += 0.025) {
      for (const half of [0.001, 0.003, 0.01, 0.03, 0.1, 0.3]) {
        const from = onContact(middle - half, 1.1);
        const to = onContact(middle + half, 1.3);
        const kept = field.alongMove(from, to, 0.001);
        for (let step = 0; step <= 32; step += 1) {
          const t = step / 32;
          const x = from.x + t * (to.x - from.x);
          const y = from.y + t * (to.y - from.y);
          const bound = from.z + t * (to.z - from.z) + 0.001;
          const all = field.constraintAtPoint(x, y, bound);
          const some = kept === null ? bound : kept(x, y, bound);
          expect(Math.abs(some - all)).toBeLessThanOrEqual(TOLERANCE_MM);
        }
      }
    }
  });
});
