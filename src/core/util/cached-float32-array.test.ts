import { describe, expect, it } from 'vitest';
import { cachedFloat32Array } from './cached-float32-array';

describe('cachedFloat32Array', () => {
  it('converts to an equivalent Float32Array', () => {
    const values = [0, 1, 2, 3.5, -4.25, 6];
    const owner = { meshPositions: values };

    const array = cachedFloat32Array(owner, values);

    expect(array).toBeInstanceOf(Float32Array);
    expect([...array]).toEqual(values);
  });

  it('returns the same buffer for repeated reads of one owner', () => {
    const values = [1, 2, 3];
    const owner = { meshPositions: values };

    expect(cachedFloat32Array(owner, values)).toBe(cachedFloat32Array(owner, values));
  });

  // Scene objects are immutable and rebuilt by spread on every edit, so an
  // edited mesh is a different owner and must never read the previous entry.
  it('does not serve a stale buffer to a rebuilt owner', () => {
    const original = { meshPositions: [1, 2, 3] };
    const first = cachedFloat32Array(original, original.meshPositions);
    const edited = { ...original, meshPositions: [9, 9, 9] };

    const second = cachedFloat32Array(edited, edited.meshPositions);

    expect(second).not.toBe(first);
    expect([...second]).toEqual([9, 9, 9]);
    expect([...first]).toEqual([1, 2, 3]);
  });

  // The reference compare is what makes the cache unable to go wrong: an owner
  // mutated in place still gets an array matching the values passed in.
  it('recomputes when the same owner presents a different array', () => {
    const owner = { meshPositions: [1, 2, 3] as ReadonlyArray<number> };
    const first = cachedFloat32Array(owner, owner.meshPositions);

    const replacement = [7, 8, 9];
    const second = cachedFloat32Array(owner, replacement);

    expect(second).not.toBe(first);
    expect([...second]).toEqual([7, 8, 9]);
  });

  it('reuses a typed relief mesh without allocating a second buffer', () => {
    const owner = {};
    const values = Float32Array.from([1, 2, 3]);

    expect(cachedFloat32Array(owner, values)).toBe(values);
  });
});
