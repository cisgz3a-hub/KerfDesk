// Arcs in the XZ and YZ planes (ADR-630 Amendment 2): drawn where GRBL runs
// them, with their exact extent in the program's bounds, K read as the offset
// it is there, and the position advanced to the arc's end.

import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from './gcode-render-model';
import { grblExecutedPoints, type ExecutedPoint } from './grbl-arc-reference.test-support';
import type { AxisBounds, GcodeRenderModel } from './render-model-types';

const ORIGIN = { x: 0, y: 0, z: 0 };
// Float32 positions hold about seven significant digits.
const DRAWN_MM = 1e-4;

function built(gcode: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(gcode, { machineKind: 'cnc' });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

/** Both ends of every drawn move, in order. */
function drawnPoints(model: GcodeRenderModel): ExecutedPoint[] {
  const points: ExecutedPoint[] = [];
  for (let index = 0; index < model.positions.length; index += 3) {
    points.push({
      x: model.positions[index] ?? Number.NaN,
      y: model.positions[index + 1] ?? Number.NaN,
      z: model.positions[index + 2] ?? Number.NaN,
    });
  }
  return points;
}

/** Where each drawn move ends. */
function moveEnds(model: GcodeRenderModel): ExecutedPoint[] {
  return drawnPoints(model).filter((_point, index) => index % 2 === 1);
}

function boxOf(points: ReadonlyArray<ExecutedPoint>): AxisBounds {
  const values = (axis: 'x' | 'y' | 'z') => points.map((point) => point[axis]);
  return {
    minX: Math.min(...values('x')),
    maxX: Math.max(...values('x')),
    minY: Math.min(...values('y')),
    maxY: Math.max(...values('y')),
    minZ: Math.min(...values('z')),
    maxZ: Math.max(...values('z')),
  };
}

// The bounds hold every point GRBL visits and nothing beyond its path. Each
// program's first move sets X, Y and Z, so the assumed start is left out of
// the bounds (ADR-255 Amendment 2) and out of the comparison.
function expectBoundsMatchGrbl(gcode: string): GcodeRenderModel {
  const model = built(gcode);
  expect(model.skippedMotions).toEqual([]);
  const executed = boxOf(grblExecutedPoints(gcode, ORIGIN).slice(1));
  const bounds = model.stats.programBounds;
  if (bounds === null) throw new Error('no bounds');
  for (const key of ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'] as const) {
    expect(bounds[key], key).toBeCloseTo(executed[key], 4);
  }
  // Every drawn vertex lies on the path GRBL runs, so the drawing agrees too.
  const drawn = boxOf(drawnPoints(model).slice(1));
  for (const key of ['minX', 'minY', 'minZ'] as const) {
    expect(drawn[key], key).toBeGreaterThanOrEqual(executed[key] - DRAWN_MM);
  }
  for (const key of ['maxX', 'maxY', 'maxZ'] as const) {
    expect(drawn[key], key).toBeLessThanOrEqual(executed[key] + DRAWN_MM);
  }
  return model;
}

describe('G18 and G19 arcs (ADR-630 Amendment 2)', () => {
  it.each([
    ['I/K', 'G18 G2 X20 Z-1 I5 K0'],
    ['R', 'G18 G2 X20 Z-1 R5'],
  ])('draws a G18 arc in %s form in the XZ plane', (_form, arc) => {
    const model = expectBoundsMatchGrbl(`G21 G90\nG0 X10 Y0 Z-1\nG1 F300\n${arc}\nG1 Y5\n`);
    // A G2 viewed from +Y, Z to the right and X up, turns clockwise: from
    // X10 to X20 it passes Z-6, below its ends.
    expect(model.stats.programBounds).toMatchObject({ minX: 10, maxX: 20, minY: 0, maxY: 5 });
    expect(model.stats.programBounds?.minZ).toBeCloseTo(-6, 6);
    // The arc ends where GRBL's does, so the next move starts there.
    const points = drawnPoints(model);
    expect(points.at(-2)).toEqual({ x: 20, y: 0, z: -1 });
    expect(points.at(-1)).toEqual({ x: 20, y: 5, z: -1 });
    // The rapid from the drawn start, half a turn of radius 5, then Y5.
    expect(model.totalRouteMm).toBeCloseTo(Math.hypot(10, 1) + 5 * Math.PI + 5, 3);
  });

  it.each([
    ['J/K', 'G19 G3 Y40 Z29 J0 K30'],
    ['R', 'G19 G3 Y40 Z29 R30'],
  ])('draws a G19 lead-out in %s form in the YZ plane', (_form, arc) => {
    const model = expectBoundsMatchGrbl(`G21 G90\nG0 X0 Y0 Z-1\nG1 Y10 F800\n${arc}\n`);
    expect(model.stats.programBounds).toMatchObject({ minY: 0, maxY: 40, minX: 0, maxX: 0 });
    expect(model.stats.programBounds?.maxZ).toBeCloseTo(29, 6);
  });

  it('takes the major arc for a negative R, and moves the linear axis evenly on a helix', () => {
    expectBoundsMatchGrbl('G21 G90\nG0 X10 Y0 Z-1\nG1 F300\nG18 G3 X20 Z-1 R-6\n');
    const helix = expectBoundsMatchGrbl('G21 G90\nG0 X10 Y0 Z-1\nG1 F300\nG18 G2 X20 Y8 Z-1 I5\n');
    // The arc's moves, after the rapid, from Y0.
    const ys = [
      0,
      ...moveEnds(helix)
        .slice(1)
        .map((point) => point.y),
    ];
    const steps = ys.slice(1).map((y, index) => y - (ys[index] ?? 0));
    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0, 4);
    expect(ys.at(-1)).toBe(8);
  });

  it('draws a full circle in the YZ plane when the arc ends where it starts', () => {
    const model = expectBoundsMatchGrbl('G21 G90\nG0 X0 Y0 Z0\nG1 F300\nG19 G2 Y0 Z0 J5 K0\n');
    expect(model.stats.programBounds).toMatchObject({ minY: 0, maxY: 10 });
  });

  it('reads K as an offset only on a G18 or G19 arc', () => {
    const unsupportedK = (gcode: string) =>
      built(gcode).unsupportedWords.some((entry) => entry.word === 'K');
    expect(unsupportedK('G0 X10 Z-1\nG18 G2 X20 Z-1 I5 K0 F300\n')).toBe(false);
    expect(unsupportedK('G0 Y10 Z-1\nG19 G3 Y40 Z29 J0 K30 F300\n')).toBe(false);
    // GRBL ignores K on an XY arc; the Inspector still names it.
    expect(unsupportedK('G2 X10 Y0 I5 J0 K3 F300\n')).toBe(true);
    expect(unsupportedK('G18\nG1 X5 K2 F300\n')).toBe(true);
  });

  it('names the plane offsets an arc is missing', () => {
    const model = built('G21 G90\nG19\nG2 Y10 Z0 I5 F300\n');
    expect(model.skippedMotions.map((skip) => skip.reason)).toEqual(['arc needs J/K or R']);
  });
});
