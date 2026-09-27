import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { kernelForTool } from '../sim';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { FinishingPoint } from './relief-finishing-path';
import { createMaskStock } from './relief-mask-stock';
import { blockExcess, type BlockLaw, type Move } from './relief-mask-stock-move';
import { stockCheckedPath } from './relief-mask-stock-path';
import { bruteForceTip, maskedMapArb, TOOLS } from './relief-mask-stock.test-support';

// ADR-484: moves checked exactly against the blocks of excluded stock.

const TOLERANCE_MM = 0.002;
const SAMPLES = 4000;

describe('blockExcess (ADR-484)', () => {
  it('never finds a move higher above a block than dense sampling does', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOOLS),
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        fc.record({
          x: fc.double({ min: -3, max: 3, noNaN: true }),
          y: fc.double({ min: -3, max: 3, noNaN: true }),
          z: fc.double({ min: -3, max: 0.5, noNaN: true }),
          dx: fc.double({ min: -5, max: 5, noNaN: true }),
          dy: fc.double({ min: -5, max: 5, noNaN: true }),
          dz: fc.double({ min: -3, max: 3, noNaN: true }),
        }),
        fc.double({ min: 0.05, max: 0.6, noNaN: true }),
        (tool, clearanceMm, move: Move, size) => {
          const radiusMm = tool.diameterMm / 2;
          const law: BlockLaw = {
            top: 0.001,
            clearanceMm,
            radiusMm,
            reachMm: radiusMm + clearanceMm,
            dz: (r) => cuttingSurfaceDz(tool, r, radiusMm),
          };
          const block = { x0: 0, x1: size, y0: 0, y1: size };
          let lowest = Number.POSITIVE_INFINITY;
          let highest = Number.NEGATIVE_INFINITY;
          for (let step = 0; step <= SAMPLES; step += 1) {
            const t = step / SAMPLES;
            const x = move.x + t * move.dx;
            const y = move.y + t * move.dy;
            const distance = Math.hypot(gap(x, 0, size), gap(y, 0, size));
            if (distance > law.reachMm) continue;
            const needed =
              law.top - law.dz(Math.min(radiusMm, Math.max(0, distance - clearanceMm)));
            lowest = Math.min(lowest, move.z + t * move.dz - needed);
            highest = Math.max(highest, needed);
          }
          const excess = blockExcess(move, block, law);
          if (excess === null) {
            expect(lowest).toBe(Number.POSITIVE_INFINITY);
            return;
          }
          expect(excess.h).toBeLessThanOrEqual(lowest + 1e-9);
          expect(excess.highest).toBeGreaterThanOrEqual(highest - 1e-9);
        },
      ),
      { numRuns: 2000, seed: 451 },
    );
  });
});

describe('stockCheckedPath (ADR-484)', () => {
  it('keeps every point of every move clear of the real blocks', () => {
    fc.assert(
      fc.property(
        maskedMapArb,
        fc.constantFrom(...TOOLS),
        fc.array(
          fc.tuple(
            fc.double({ min: -0.2, max: 1.2, noNaN: true }),
            fc.double({ min: -0.2, max: 1.2, noNaN: true }),
            fc.double({ min: -3, max: 0.5, noNaN: true }),
          ),
          { minLength: 2, maxLength: 6 },
        ),
        (map, tool, spec) => {
          const kernel = kernelForTool(tool, map.mmPerCell);
          const clearanceMm = kernel.maskPathUncertaintyMm;
          const stock = createMaskStock(map, kernel, clearanceMm, TOLERANCE_MM);
          if (stock === null) throw new Error('expected excluded stock');
          // Vertices clear the raised blocks, as a masked raster's samples do.
          const points: FinishingPoint[] = spec.map(([u, v, z]) => {
            const x = u * map.widthMm;
            const y = v * map.heightMm;
            return { x, y, z: Math.max(z, stock.tipAt(x, y)) };
          });
          const checked = stockCheckedPath(points, stock);

          // Every input point is kept, in order, never lowered.
          let next = 0;
          for (const point of checked) {
            if (next < points.length && sameXY(point, points[next])) {
              expect(point.z).toBeGreaterThanOrEqual(points[next]?.z ?? 0);
              next += 1;
            }
          }
          expect(next).toBe(points.length);
          for (let index = 1; index < checked.length; index += 1) {
            const from = checked[index - 1];
            const to = checked[index];
            if (from === undefined || to === undefined) continue;
            const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.01) + 1;
            for (let step = 0; step <= steps; step += 1) {
              const t = step / steps;
              const x = from.x + t * (to.x - from.x);
              const y = from.y + t * (to.y - from.y);
              const z = from.z + t * (to.z - from.z);
              expect(z).toBeGreaterThanOrEqual(bruteForceTip(map, tool, clearanceMm, x, y) - 1e-9);
            }
          }
        },
      ),
      { numRuns: 150, seed: 451 },
    );
  });
});

function gap(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  return value > end ? value - end : 0;
}

function sameXY(a: FinishingPoint, b: FinishingPoint | undefined): boolean {
  return b !== undefined && a.x === b.x && a.y === b.y;
}
