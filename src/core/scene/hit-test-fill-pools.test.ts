// Rolling audit v8 N6-P2-1 (ADR-683 Amendment 1): the canvas pools a Fill
// operation even-odd, so a window cut by a separate Fill object, or a pair of
// stacked copies, is drawn empty. The hit test still treated each object
// alone, so a click on the Line square shown inside picked the window object.
import { describe, expect, it } from 'vitest';
import { hitTest } from './hit-test';
import { hitTestCandidates } from './hit-test-candidates';
import { createLayer, type Layer } from './layer';
import type { Scene } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';

const FILL = 'fill';
const LINE = 'line';

function rect(
  id: string,
  operationIds: ReadonlyArray<string>,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: box,
    transform: IDENTITY_TRANSFORM,
    operationIds: [...operationIds],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: box.minX, y: box.minY },
              { x: box.maxX, y: box.minY },
              { x: box.maxX, y: box.maxY },
              { x: box.minX, y: box.maxY },
            ],
          },
        ],
      },
    ],
  };
}

function scene(objects: ReadonlyArray<SceneObject>, layers?: ReadonlyArray<Layer>): Scene {
  return {
    groups: [],
    layers: [
      ...(layers ?? [
        createLayer({ id: FILL, color: '#000000', mode: 'fill' }),
        createLayer({ id: LINE, color: '#0000ff', mode: 'line' }),
      ]),
    ],
    objects: [...objects],
  };
}

const plate = rect('plate', [FILL], { minX: 0, minY: 0, maxX: 60, maxY: 40 });
const window = rect('window', [FILL], { minX: 15, minY: 5, maxX: 45, maxY: 35 });
const square = rect('square', [LINE], { minX: 25, minY: 15, maxX: 35, maxY: 25 });
const SQUARE_EDGE = { x: 25, y: 20 };
const SQUARE_CENTRE = { x: 30, y: 20 };
const EMPTY_WINDOW = { x: 18, y: 20 };
const PLATE_BODY = { x: 5, y: 20 };

describe('hitTest — holes that a Fill pool makes (N6-P2-1)', () => {
  it.each([
    ['square, plate, window', [square, plate, window]],
    ['plate, square, window', [plate, square, window]],
    ['plate, window, square', [plate, window, square]],
  ])('picks the Line square shown in a separate window (drawn %s)', (_order, objects) => {
    const plaque = scene(objects);

    expect(hitTest(plaque, SQUARE_EDGE)).toBe('square');
    expect(hitTest(plaque, SQUARE_CENTRE)).toBe('square');
    // The empty window still selects the shape that cuts it, as one object's hole does.
    expect(hitTest(plaque, EMPTY_WINDOW)).toBe('window');
    expect(hitTest(plaque, PLATE_BODY)).toBe('plate');
    expect(hitTestCandidates(plaque, SQUARE_CENTRE)[0]).toBe('square');
  });

  it('counts a scaled, mirrored and turned window where it is drawn', () => {
    // A 20 x 10 outline at (0, 0)-(20, 10), placed onto the same 30 x 30 window.
    const placed: SceneObject = {
      ...rect('window', [FILL], { minX: 0, minY: 0, maxX: 20, maxY: 10 }),
      transform: {
        ...IDENTITY_TRANSFORM,
        scaleX: 1.5,
        scaleY: 3,
        mirrorX: true,
        rotationDeg: 90,
        x: 45,
        y: 35,
      },
    };
    const plaque = scene([square, plate, placed]);

    expect(hitTest(plaque, SQUARE_CENTRE)).toBe('square');
    expect(hitTest(plaque, EMPTY_WINDOW)).toBe('window');
    expect(hitTest(plaque, PLATE_BODY)).toBe('plate');
  });

  it('lets clicks through stacked copies that cancel to the square under them', () => {
    const copy = (id: string): SceneObject => ({ ...plate, id });
    const stacked = scene([square, copy('copyA'), copy('copyB')]);

    expect(hitTest(stacked, SQUARE_EDGE)).toBe('square');
    expect(hitTest(stacked, SQUARE_CENTRE)).toBe('square');
    expect(hitTest(stacked, PLATE_BODY)).toBe('copyB');
    // A third copy burns again, and is solid again.
    expect(hitTest(scene([square, copy('a'), copy('b'), copy('c')]), SQUARE_CENTRE)).toBe('c');
  });

  it('keeps a window solid where a second Fill operation still burns it', () => {
    const layers = [
      createLayer({ id: FILL, color: '#000000', mode: 'fill' }),
      createLayer({ id: 'second', color: '#ff0000', mode: 'fill' }),
      createLayer({ id: LINE, color: '#0000ff', mode: 'line' }),
    ];
    const twice = { ...window, operationIds: [FILL, 'second'] };

    expect(hitTest(scene([square, plate, twice], layers), SQUARE_CENTRE)).toBe('window');
    // Hidden, the second operation shows and picks nothing: the window is a hole again.
    const hidden = layers.map((layer) =>
      layer.id === 'second' ? { ...layer, visible: false } : layer,
    );
    expect(hitTest(scene([square, plate, twice], hidden), SQUARE_CENTRE)).toBe('square');
  });

  it('pools only one operation: a window on another Fill operation stays solid', () => {
    const layers = [
      createLayer({ id: FILL, color: '#000000', mode: 'fill' }),
      createLayer({ id: 'other', color: '#ff0000', mode: 'fill' }),
      createLayer({ id: LINE, color: '#0000ff', mode: 'line' }),
    ];
    const apart = { ...window, operationIds: ['other'] };

    expect(hitTest(scene([square, plate, apart], layers), SQUARE_CENTRE)).toBe('window');
  });
});
