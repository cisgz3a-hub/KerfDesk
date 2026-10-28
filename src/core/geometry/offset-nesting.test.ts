// ADR-410 Amendment 3: Offset Shapes and the properties-panel offset read a
// shape drawn as its own object inside another as a hole, the way the same art
// drawn as one compound path, the kerf offset (ADR-486) and LightBurn read it.
// Shapes that only overlap are still unioned (ADR-410 item 3).

import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg, type Polyline } from '../scene';
import { offsetShapes, type OffsetShapesOptions } from './offset-shapes';
import { offsetVectorObjects } from './vector-path-booleans';

const IDS = { outward: 'out', inward: 'in' };
const DIRECTIONS = ['outward', 'inward', 'both'] as const;
const STYLES = ['round', 'bevel', 'corner'] as const;

function rect(minX: number, minY: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + width, y: minY },
      { x: minX + width, y: minY + height },
      { x: minX, y: minY + height },
      { x: minX, y: minY },
    ],
  };
}

function path(...polylines: Polyline[]): ColoredPath {
  return { color: '#ff0000', polylines };
}

function art(id: string, ...paths: ColoredPath[]): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function options(patch: Partial<OffsetShapesOptions>): OffsetShapesOptions {
  return {
    distanceMm: 1,
    direction: 'outward',
    cornerStyle: 'corner',
    outerShapesOnly: false,
    ...patch,
  };
}

type Ring = { readonly x: readonly [number, number]; readonly y: readonly [number, number] };

const round = (value: number): number => Math.round(value * 1000) / 1000;

function ringArea(polyline: Polyline): number {
  let sum = 0;
  polyline.points.forEach((a, index) => {
    const b = polyline.points[(index + 1) % polyline.points.length]!;
    sum += a.x * b.y - b.x * a.y;
  });
  return Math.abs(sum / 2);
}

function ringOf(polyline: Polyline): Ring & { readonly area: number } {
  const xs = polyline.points.map((point) => point.x);
  const ys = polyline.points.map((point) => point.y);
  return {
    x: [round(Math.min(...xs)), round(Math.max(...xs))] as const,
    y: [round(Math.min(...ys)), round(Math.max(...ys))] as const,
    area: round(ringArea(polyline)),
  };
}

// Each ring's extent, rounded to the µm, in a stable order. The area is kept
// too, so a notched outline cannot pass for the plain plate around it.
function rings(object: ImportedSvg | null): Ring[] {
  if (object === null) return [];
  return object.paths
    .flatMap((each) => each.polylines)
    .map(ringOf)
    .sort((a, b) => a.x[0] - b.x[0] || a.y[0] - b.y[0] || b.x[1] - a.x[1]);
}

// The extents alone, for expectations written out by hand.
function extents(list: ReadonlyArray<Ring>): Ring[] {
  return list.map(({ x, y }) => ({ x, y }));
}

function run(objects: ReadonlyArray<ImportedSvg>, patch: Partial<OffsetShapesOptions>) {
  const result = offsetShapes(objects, options(patch), IDS);
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return { outward: rings(result.value.outward), inward: rings(result.value.inward) };
}

function panel(objects: ReadonlyArray<ImportedSvg>, deltaMm: number): Ring[] {
  const result = offsetVectorObjects(objects, deltaMm, 'offset');
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return rings(result.value);
}

const PLATE = rect(0, 0, 50, 30);
const HOLE = rect(20, 10, 10, 10);
const separate = [art('plate', path(PLATE)), art('hole', path(HOLE))];
const compound = [art('sheet', path(PLATE, HOLE))];

describe('Offset Shapes with a shape drawn inside another as its own object', () => {
  it('offsets the separate hole as the compound path offsets its hole', () => {
    expect(extents(run(separate, {}).outward)).toEqual([
      { x: [-1, 51], y: [-1, 31] },
      { x: [21, 29], y: [11, 19] },
    ]);
    expect(extents(run(separate, { direction: 'inward' }).inward)).toEqual([
      { x: [1, 49], y: [1, 29] },
      { x: [19, 31], y: [9, 21] },
    ]);
  });

  it('matches the compound twin for every direction, corner style and Outer shapes only', () => {
    for (const direction of DIRECTIONS) {
      for (const cornerStyle of STYLES) {
        for (const outerShapesOnly of [false, true]) {
          const patch = { direction, cornerStyle, outerShapesOnly };
          expect(run(separate, patch), JSON.stringify(patch)).toEqual(run(compound, patch));
        }
      }
    }
  });

  it('drops the separate inner shape when Outer shapes only is on', () => {
    const result = run(separate, { direction: 'both', outerShapesOnly: true });
    expect(extents(result.outward)).toEqual([{ x: [-1, 51], y: [-1, 31] }]);
    expect(extents(result.inward)).toEqual([{ x: [1, 49], y: [1, 29] }]);
  });

  it('reads the selection the same in either order', () => {
    expect(run([...separate].reverse(), { direction: 'both' })).toEqual(
      run(separate, { direction: 'both' }),
    );
  });

  it('treats two paths of one object, as an SVG with a fill-rule per element imports, as nested', () => {
    const svg = art('svg', { ...path(PLATE), fillRule: 'nonzero' }, path(HOLE));
    expect(run([svg], {}).outward).toEqual(run(compound, {}).outward);
  });

  it('keeps an island drawn inside the separate hole', () => {
    const island = art('island', path(rect(23, 13, 4, 4)));
    expect(extents(run([...separate, island], {}).outward)).toEqual([
      { x: [-1, 51], y: [-1, 31] },
      { x: [21, 29], y: [11, 19] },
      { x: [22, 28], y: [12, 18] },
    ]);
  });

  it('makes a hole of a shape inside two overlapping plates, one level down', () => {
    const left = art('left', path(rect(0, 0, 30, 20)));
    const right = art('right', path(rect(20, 0, 30, 20)));
    const hole = art('hole', path(rect(22, 5, 6, 10)));
    expect(extents(run([left, right, hole], {}).outward)).toEqual([
      { x: [-1, 51], y: [-1, 21] },
      { x: [23, 27], y: [6, 14] },
    ]);
  });

  it('places each ring of one path by its own depth when another object sits between them', () => {
    // As the kerf offset does: the plate is an outline, the separate square
    // around its small hole is a hole, and that small hole is an island again.
    const frame = art('frame', path(rect(0, 0, 100, 100), rect(45, 45, 10, 10)));
    const between = art('between', path(rect(30, 30, 40, 40)));
    expect(extents(run([frame, between], {}).outward)).toEqual([
      { x: [-1, 101], y: [-1, 101] },
      { x: [31, 69], y: [31, 69] },
      { x: [44, 56], y: [44, 56] },
    ]);
  });

  it('splits one path whose shapes lie inside and outside another object', () => {
    const scattered = art('scattered', path(rect(10, 10, 10, 10), rect(60, 0, 10, 10)));
    expect(extents(run([art('plate', path(PLATE)), scattered], {}).outward)).toEqual([
      { x: [-1, 51], y: [-1, 31] },
      { x: [11, 19], y: [11, 19] },
      { x: [59, 71], y: [-1, 11] },
    ]);
  });

  it('cuts a notch drawn inside the plate along its edge, as the compound path does', () => {
    const notch = rect(20, 0, 10, 10);
    const twin = run([art('sheet', path(PLATE, notch))], {});
    expect(run([art('plate', path(PLATE)), art('notch', path(notch))], {})).toEqual(twin);
    expect(twin.outward).toHaveLength(1);
  });
});

describe('Offset Shapes still unions shapes that only overlap (ADR-410 item 3)', () => {
  it('welds two overlapping squares into one outline', () => {
    const a = art('a', path(rect(0, 0, 10, 10)));
    const b = art('b', path(rect(5, 0, 10, 10)));
    expect(extents(run([a, b], {}).outward)).toEqual([{ x: [-1, 16], y: [-1, 11] }]);
  });

  it('does not let two copies of one shape cancel each other', () => {
    const a = art('a', path(HOLE));
    const b = art('b', path(HOLE));
    expect(extents(run([a, b], {}).outward)).toEqual([{ x: [19, 31], y: [9, 21] }]);
  });

  it('lets a bar laid across a washer bridge its hole, as Weld would', () => {
    const washer = art('washer', path(rect(0, 0, 30, 30), rect(10, 10, 10, 10)));
    const bar = art('bar', path(rect(-5, 13, 40, 4)));
    expect(extents(run([washer, bar], {}).outward)).toEqual([
      { x: [-6, 36], y: [-1, 31] },
      { x: [11, 19], y: [11, 12] },
      { x: [11, 19], y: [18, 19] },
    ]);
  });

  it('merges a separate hole that overlaps the plate’s own hole', () => {
    const sheet = art('sheet', path(PLATE, HOLE));
    const slot = art('slot', path(rect(25, 12, 15, 6)));
    expect(extents(run([sheet, slot], {}).outward)).toEqual([
      { x: [-1, 51], y: [-1, 31] },
      { x: [21, 39], y: [11, 19] },
    ]);
  });
});

describe('the properties-panel offset (Offset outlines row)', () => {
  it('offsets a separately drawn hole as it offsets the compound twin', () => {
    expect(panel(separate, 1)).toEqual(panel(compound, 1));
    expect(extents(panel(separate, 1))).toEqual([
      { x: [-1, 51], y: [-1, 31] },
      { x: [21, 29], y: [11, 19] },
    ]);
    expect(panel(separate, -1)).toEqual(panel(compound, -1));
    expect(extents(panel(separate, -1))).toEqual([
      { x: [1, 49], y: [1, 29] },
      { x: [19, 31], y: [9, 21] },
    ]);
  });

  it('still unions overlapping shapes', () => {
    const a = art('a', path(rect(0, 0, 10, 10)));
    const b = art('b', path(rect(5, 0, 10, 10)));
    expect(extents(panel([a, b], 1))).toEqual([{ x: [-1, 16], y: [-1, 11] }]);
  });
});
