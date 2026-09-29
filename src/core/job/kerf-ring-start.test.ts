import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { startKerfRingsAtSources } from './kerf-ring-start';

function ring(...points: ReadonlyArray<readonly [number, number]>): Polyline {
  const vertices = points.map(([x, y]) => ({ x, y }));
  return { closed: true, points: [...vertices, ...vertices.slice(0, 1)] };
}

// The ring's edges as "from>to" pairs: the same set in the same direction means
// the same closed path, whichever vertex it starts at.
function edges(polyline: Polyline | undefined): ReadonlyArray<string> {
  const points = polyline?.points ?? [];
  const key = (point: Vec2 | undefined): string => `${point?.x},${point?.y}`;
  return points
    .slice(1)
    .map((point, index) => `${key(points[index])}>${key(point)}`)
    .sort();
}

describe('startKerfRingsAtSources', () => {
  it('turns a ring to begin at its vertex nearest the drawn start, in the same direction', () => {
    const source = ring([10, 0], [10, 10], [0, 10], [0, 0]);
    const offset = ring([-1, -1], [-1, 11], [11, 11], [11, -1]);

    const [started] = startKerfRingsAtSources([offset], [source], 1);

    expect(started?.points[0]).toEqual({ x: 11, y: -1 });
    expect(started?.points.at(-1)).toEqual({ x: 11, y: -1 });
    expect(started?.points).toHaveLength(offset.points.length);
    expect(edges(started)).toEqual(edges(offset));
  });

  it('returns a ring that already starts there unchanged', () => {
    const source = ring([0, 0], [10, 0], [10, 10], [0, 10]);
    const offset = ring([-1, -1], [11, -1], [11, 11], [-1, 11]);

    expect(startKerfRingsAtSources([offset], [source], 1)[0]).toBe(offset);
  });

  it('starts each ring of a compound path near its own contour’s start', () => {
    const outer = ring([40, 0], [40, 40], [0, 40], [0, 0]);
    const hole = ring([10, 30], [30, 30], [30, 10], [10, 10]);
    const grownOuter = ring([-1, -1], [41, -1], [41, 41], [-1, 41]);
    const shrunkHole = ring([11, 11], [29, 11], [29, 29], [11, 29]);

    const [first, second] = startKerfRingsAtSources([shrunkHole, grownOuter], [outer, hole], 1);

    expect(first?.points[0]).toEqual({ x: 11, y: 29 });
    expect(second?.points[0]).toEqual({ x: 41, y: -1 });
  });
});
