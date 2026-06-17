import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type Scene, type SceneObject, type Vec2 } from '../../core/scene';
import { selectObjectsInMarquee } from './selection-marquee';

function objectAt(id: string, x: number, y: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [],
  };
}

function scene(objects: ReadonlyArray<SceneObject>): Scene {
  return { objects, layers: [] };
}

describe('selectObjectsInMarquee', () => {
  it('returns every object whose transformed bounds intersects the drag box', () => {
    const selected = selectObjectsInMarquee(
      scene([objectAt('A', 0, 0), objectAt('B', 20, 0), objectAt('C', 80, 0)]),
      { x: -5, y: -5 },
      { x: 25, y: 15 },
    );

    expect(selected).toEqual(['A', 'B']);
  });

  it('normalizes reverse drag direction', () => {
    const start: Vec2 = { x: 25, y: 15 };
    const end: Vec2 = { x: -5, y: -5 };

    expect(selectObjectsInMarquee(scene([objectAt('A', 0, 0)]), start, end)).toEqual(['A']);
  });
});
