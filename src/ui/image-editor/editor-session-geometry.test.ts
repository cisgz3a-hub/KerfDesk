import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { rectSelection } from '../../core/image-select/marquee';
import { appliedBounds, commitCrop, createSession, revertSession } from './editor-session';
import { commitCanvasSize, commitImageSize } from './editor-session-resize';

function session() {
  const doc = createRgbaBuffer(10, 10);
  for (let i = 0; i < 100; i += 1) doc.data[i * 4] = i;
  return createSession('image', 'fixture', doc, { minX: 10, minY: 20, maxX: 20, maxY: 30 });
}

describe('document rectangle intersection', () => {
  it.each([
    { x: -20, y: 1, width: 5, height: 3 },
    { x: 12, y: 1, width: 3, height: 3 },
    { x: 1, y: -20, width: 3, height: 5 },
    { x: 1, y: 12, width: 3, height: 3 },
  ])('ignores a rectangle entirely outside the image: %j', (rect) => {
    expect([...rectSelection(10, 10, rect).alpha].some((x) => x !== 0)).toBe(false);
    const original = session();
    expect(commitCrop(original, rect)).toBe(original);
  });

  it('crops only the intersecting source pixels at the left edge', () => {
    const cropped = commitCrop(session(), { x: -2, y: 1, width: 5, height: 3 });
    expect([cropped.doc.width, cropped.doc.height]).toEqual([3, 3]);
    expect(Array.from({ length: 3 }, (_, x) => cropped.doc.data[x * 4])).toEqual([10, 11, 12]);
    expect(appliedBounds(cropped)).toEqual({ minX: 10, minY: 21, maxX: 13, maxY: 24 });
  });
});

describe('Image Size physical mapping', () => {
  it('preserves a nonintegral cropped extent through repeated anisotropic resizes', () => {
    const cropped = commitCrop(session(), { x: 2, y: 2, width: 3, height: 3 });
    const expected = appliedBounds(cropped);
    if (expected === null) throw new Error('Expected cropped bounds');
    let resized = cropped;
    for (const [width, height] of [
      [2, 2],
      [7, 5],
      [1, 9],
      [3, 3],
    ] as const) {
      resized = commitImageSize(resized, width, height);
      const bounds = appliedBounds(resized);
      if (bounds === null) throw new Error('Expected resized cropped bounds');
      expect(bounds.minX).toBeCloseTo(expected.minX, 12);
      expect(bounds.minY).toBeCloseTo(expected.minY, 12);
      expect(bounds.maxX).toBeCloseTo(expected.maxX, 12);
      expect(bounds.maxY).toBeCloseTo(expected.maxY, 12);
    }
    expect(appliedBounds(revertSession(resized))).toBeNull();
  });

  it('retains the extent when a resized crop happens to match the rounded Revert size', () => {
    const resized = commitImageSize(
      commitCrop(session(), { x: 0, y: 0, width: 9, height: 9 }),
      1,
      1,
    );
    expect(appliedBounds(resized)).toEqual({ minX: 10, minY: 20, maxX: 19, maxY: 29 });
  });

  it('maps Canvas Size and later crop at the new pixel density', () => {
    const resized = commitImageSize(
      commitCrop(session(), { x: 2, y: 2, width: 3, height: 3 }),
      2,
      2,
    );
    const padded = commitCanvasSize(resized, 4, 4, { x: 0.5, y: 0.5 });
    expect(appliedBounds(padded)).toEqual({ minX: 10.5, minY: 20.5, maxX: 16.5, maxY: 26.5 });
    const cropped = commitCrop(padded, { x: 1, y: 1, width: 2, height: 2 });
    expect(appliedBounds(cropped)).toEqual({ minX: 12, minY: 22, maxX: 15, maxY: 25 });
  });
});
