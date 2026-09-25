import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageCanvas } from './paged-artwork-source';

afterEach(() => vi.restoreAllMocks());

describe('document page canvas allocation', () => {
  it('allows a representable narrow page beyond a guessed 16,384-pixel edge limit', () => {
    const canvas = pageCanvas(20_000.25, 1);
    expect(canvas.width).toBe(20_001);
    expect(canvas.height).toBe(1);
  });

  it.each([0, -1, NaN, Infinity])('rejects an invalid page dimension %s', (dimension) => {
    expect(() => pageCanvas(dimension, 1)).toThrow('positive and finite');
    expect(() => pageCanvas(1, dimension)).toThrow('positive and finite');
  });

  it('rejects a dimension the canvas integer representation cannot preserve', () => {
    expect(() => pageCanvas(2 ** 32 + 1, 1)).toThrow('cannot represent');
  });

  it('reports an actual unavailable browser drawing context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => pageCanvas(100, 100)).toThrow('could not create a canvas');
  });
});
