// S2-P3-3: panels name every member of a large selection on each render, and
// a drag re-renders them per step. A file name is cleaned once, not once per
// object per render. Counted, not timed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { artworkOperationName } from './artwork-operation';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('artworkOperationName for imported artwork', () => {
  it('cleans each file name once across thousands of objects and renders', () => {
    const objects = Array.from({ length: 2000 }, (_, index) =>
      imported(`o${index}`, 'C:\\designs\\badge   front.svg'),
    );
    const parses = vi.spyOn(String.prototype, 'replaceAll');
    const names = new Set<string>();
    for (let render = 0; render < 5; render += 1) {
      for (const object of objects) names.add(artworkOperationName(object));
    }
    const calls = parses.mock.calls.length;
    parses.mockRestore();
    expect([...names]).toEqual(['badge front']);
    // Main parsed the name 10,000 times here.
    expect(calls).toBeLessThanOrEqual(1);
  });

  it('names a long source the same way without keeping it', () => {
    const long = `${'x'.repeat(600)}/very   long name.png`;
    expect(artworkOperationName(imported('a', long))).toBe('very long name');
    expect(artworkOperationName(imported('b', long))).toBe('very long name');
    expect(artworkOperationName(imported('c', 'folder/'))).toBe('Artwork');
    expect(artworkOperationName({ ...imported('d', 'x.svg'), name: ' Own ' })).toBe('Own');
  });
});

function imported(id: string, source: string): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}
