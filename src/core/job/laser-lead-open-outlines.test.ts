import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { openLineHolders, type SceneOpenLine } from './laser-lead-open-outlines';

const line = (
  operationName: string,
  ...points: Array<readonly [number, number]>
): SceneOpenLine => ({
  operationName,
  points: points.map(([x, y]) => ({ x, y })),
});

function circle(cx: number, cy: number, r: number): Vec2[] {
  return Array.from({ length: 32 }, (_, index) => ({
    x: cx + r * Math.cos((index / 32) * 2 * Math.PI),
    y: cy + r * Math.sin((index / 32) * 2 * Math.PI),
  }));
}

/** A 40 mm square of four open lines, one corner left `gap` mm open. */
function sides(gap: number, name = 'Cut'): SceneOpenLine[] {
  return [
    line(name, [0, 0], [40, 0]),
    line(name, [40, 0], [40, 40]),
    line(name, [40, 40], [0, 40]),
    line(name, [0, 40], [0, gap]),
  ];
}

const HOLE = circle(20, 20, 5);
const AWAY = circle(80, 20, 5);

describe('openLineHolders (ADR-626 Amendment 8)', () => {
  it('finds a contour inside four open lines whose ends meet, and only that one', () => {
    expect(openLineHolders([HOLE, AWAY], sides(0))).toEqual(['Cut', undefined]);
  });

  it('holds a contour inside lines left open at one corner, however wide (Amendment 10)', () => {
    // Up to 0.5 mm the strokes close the square; wider, the four lines still
    // chain into one outline whose free ends are far closer together than a
    // tenth of its length (meta audit v1 M6-P1-3: exactly 0.5 mm used to slip).
    for (const gap of [0.4, 0.5, 0.6, 1, 1.5, 3]) {
      expect(openLineHolders([HOLE], sides(gap)), `gap ${gap}`).toEqual(['Cut']);
    }
  });

  it('holds a contour inside one open path left open at a corner', () => {
    const plate = line('Cut', [1.5, 0], [40, 0], [40, 40], [0, 40], [0, 0]);
    expect(openLineHolders([HOLE, AWAY], [plate])).toEqual(['Cut', undefined]);
  });

  it('leaves alone a contour in a U whose whole side is missing', () => {
    const u = line('Cut', [0, 0], [40, 0], [40, 40], [0, 40]);
    expect(openLineHolders([HOLE], [u])).toEqual([undefined]);
  });

  it('leaves alone a contour drawn on the open lines themselves', () => {
    // A closed square on top of an open one is not inside it.
    const drawnOn = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ];
    expect(
      openLineHolders([drawnOn], [line('Cut', [1, 0], [40, 0], [40, 40], [0, 40], [0, 0])]),
    ).toEqual([undefined]);
  });

  it('does not chain lines that stop short at every corner (not covered)', () => {
    // Each corner 0.6 mm open: no two ends meet, so no outline forms. ADR-626
    // Amendment 10 names this case; Join paths closes it.
    const short = [
      line('Cut', [0.6, 0], [39.4, 0]),
      line('Cut', [40, 0.6], [40, 39.4]),
      line('Cut', [39.4, 40], [0.6, 40]),
      line('Cut', [0, 39.4], [0, 0.6]),
    ];
    expect(openLineHolders([HOLE], short)).toEqual([undefined]);
  });

  it('reads lines that cross past the corners as closing the square', () => {
    const crossing = [
      line('Sketch', [-2, 0], [42, 0]),
      line('Sketch', [40, -2], [40, 42]),
      line('Sketch', [42, 40], [-2, 40]),
      line('Sketch', [0, 42], [0, -2]),
    ];
    expect(openLineHolders([HOLE], crossing)).toEqual(['Sketch']);
  });

  it('reads one open path whose ends meet as a loop', () => {
    const loop = line('Cut', [0, 0], [40, 0], [40, 40], [0, 40], [0, 0.2]);
    expect(openLineHolders([HOLE], [loop])).toEqual(['Cut']);
  });

  it('holds a contour nested in closed shapes inside the lines too', () => {
    // A part inside a hole inside an open-drawn plate: both are held.
    expect(openLineHolders([circle(20, 20, 8), HOLE], sides(0))).toEqual(['Cut', 'Cut']);
  });

  it('leaves alone a contour beside lines that close nothing', () => {
    const dangling = [line('Score', [0, 0], [40, 0]), line('Score', [40, 0], [40, 40])];
    expect(openLineHolders([HOLE], dangling)).toEqual([undefined]);
  });

  it('names the operation whose lines close the region', () => {
    const lines = [...sides(0, 'Plate'), line('Score', [100, 0], [140, 0])];
    expect(openLineHolders([HOLE], lines)).toEqual(['Plate']);
  });

  it('reads 20,000 hatch lines across one span, which close nothing', () => {
    // Lines 1 mm apart share their whole X span; they are clustered by grid
    // cell, not compared pair by pair. The four sides round the hole still
    // close it, and a dot between two hatch lines is not held.
    const hatch = Array.from({ length: 20_000 }, (_, index) =>
      line('Hatch', [-500, 100 + index], [500, 100 + index]),
    );
    expect(openLineHolders([HOLE, circle(0, 150.5, 0.2)], [...sides(0), ...hatch])).toEqual([
      'Cut',
      undefined,
    ]);
  }, 30_000);

  it('reads a contour inside a closed island within the region as held', () => {
    // An island the lines draw inside the region (a loop within the square)
    // closes a region of its own; a contour inside it is held as well.
    const island = line('Cut', [10, 10], [30, 10], [30, 30], [10, 30], [10, 10]);
    expect(openLineHolders([circle(20, 20, 3)], [...sides(0), island])).toEqual(['Cut']);
  });
});
