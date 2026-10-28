// Rolling audit v7 L1-P3-3: Weld, the Booleans and the properties-panel offset
// read closed contours by the closed-enough rule (polyline-closure.ts) that Fill,
// Offset Shapes and Select Open Shapes already use. A path flagged open whose
// last point repeats its first is closed; one whose ends stay apart is open.

import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline } from '../scene';
import { offsetShapes } from './offset-shapes';
import { combineVectorObjects, offsetVectorObjects } from './vector-path-booleans';
import { weldVectorObjects } from './vector-path-weld';

function square(minX: number, size: number, closed: boolean, repeatFirst: boolean): Polyline {
  const points = [
    { x: minX, y: 0 },
    { x: minX + size, y: 0 },
    { x: minX + size, y: size },
    { x: minX, y: size },
  ];
  return { closed, points: repeatFirst ? [...points, { x: minX, y: 0 }] : points };
}

function art(id: string, polyline: Polyline): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [polyline] }],
  };
}

const returning = art('returning', square(0, 10, false, true));
const neighbour = art('neighbour', square(5, 10, true, false));
const open = art('open', square(0, 10, false, false));

describe('a path flagged open that returns to its start', () => {
  it('welds, combines and offsets as the closed shape it draws', () => {
    expect(weldVectorObjects([returning, neighbour], 'weld').kind).toBe('ok');
    expect(combineVectorObjects([returning, neighbour], 'subtract', 'cut').kind).toBe('ok');
    const panel = offsetVectorObjects([returning], -1, 'offset');
    expect(panel.kind === 'ok' && panel.value.bounds).toMatchObject({ minX: 1, maxX: 9 });
  });

  it('gives the panel offset the inward result Offset Shapes already gave it', () => {
    const shapes = offsetShapes(
      [returning],
      { distanceMm: 1, direction: 'inward', cornerStyle: 'round', outerShapesOnly: false },
      { outward: 'out', inward: 'in' },
    );
    const panel = offsetVectorObjects([returning], -1, 'offset');
    expect(shapes.kind === 'ok' && shapes.value.inward?.paths).toEqual(
      panel.kind === 'ok' && panel.value.paths,
    );
  });

  it('still refuses a path whose ends stay apart', () => {
    const weld = weldVectorObjects([open, neighbour], 'weld');
    expect(weld.kind === 'error' && weld.error.kind).toBe('open-contours');
  });
});
