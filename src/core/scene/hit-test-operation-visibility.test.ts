import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import { hitTest } from './hit-test';
import { IDENTITY_TRANSFORM } from './scene-object';
import type { Scene } from './scene';

describe('hitTest multi-operation visibility', () => {
  it('hits geometry through the first visible binding after a hidden binding', () => {
    expect(hitTest(scene(false, true), { x: 5, y: 0 })).toBe('multi-op');
  });

  it('does not hit geometry when all bindings are hidden', () => {
    expect(hitTest(scene(false, false), { x: 5, y: 0 })).toBeNull();
  });
});

function scene(firstVisible: boolean, secondVisible: boolean): Scene {
  return {
    groups: [],
    layers: [
      { ...createLayer({ id: 'first', color: '#111111' }), visible: firstVisible },
      { ...createLayer({ id: 'second', color: '#222222' }), visible: secondVisible },
    ],
    objects: [
      {
        kind: 'imported-svg',
        id: 'multi-op',
        source: 'multi.svg',
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color: '#111111',
            operationIds: ['first', 'second'],
            polylines: [
              {
                closed: false,
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
