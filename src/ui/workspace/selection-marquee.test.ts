import { describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { selectObjectsInMarquee } from './selection-marquee';

function objectAt(
  id: string,
  x: number,
  y: number,
  locked = false,
  color = '#ff0000',
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    ...(locked ? { locked } : {}),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [{ color, polylines: [] }],
  };
}

function scene(objects: ReadonlyArray<SceneObject>): Scene {
  const colors = new Set(
    objects.flatMap((object) =>
      object.kind === 'raster-image' || object.kind === 'relief'
        ? [object.color]
        : object.paths.map((path) => path.color),
    ),
  );
  return { objects, layers: [...colors].map((color) => createLayer({ id: color, color })) };
}

describe('selectObjectsInMarquee', () => {
  // A (0..10) fits fully; B (20..30) straddles the right edge at x=25; C is out.
  const threeObjects = () =>
    scene([objectAt('A', 0, 0), objectAt('B', 20, 0), objectAt('C', 80, 0)]);

  it('enclosing select (drag left→right) keeps only fully-contained objects (C3)', () => {
    const start: Vec2 = { x: -5, y: -5 };
    const end: Vec2 = { x: 25, y: 15 };

    expect(selectObjectsInMarquee(threeObjects(), start, end)).toEqual(['A']);
  });

  it('crossing select (drag right→left) includes merely-touched objects (C3)', () => {
    const start: Vec2 = { x: 25, y: 15 };
    const end: Vec2 = { x: -5, y: -5 };

    expect(selectObjectsInMarquee(threeObjects(), start, end)).toEqual(['A', 'B']);
  });

  it('skips locked objects inside the marquee', () => {
    const selected = selectObjectsInMarquee(
      scene([objectAt('A', 0, 0, true), objectAt('B', 20, 0)]),
      { x: -5, y: -5 },
      { x: 35, y: 15 },
    );

    expect(selected).toEqual(['B']);
  });

  it('skips objects whose assigned layer is hidden', () => {
    const base = scene([
      objectAt('A', 0, 0, false, '#ff0000'),
      objectAt('B', 20, 0, false, '#0000ff'),
    ]);
    const selected = selectObjectsInMarquee(
      {
        ...base,
        layers: base.layers.map((layer) =>
          layer.id === '#ff0000' ? { ...layer, visible: false } : layer,
        ),
      },
      { x: -5, y: -5 },
      { x: 35, y: 15 },
    );

    expect(selected).toEqual(['B']);
  });
});
