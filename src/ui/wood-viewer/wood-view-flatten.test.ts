import { describe, expect, it } from 'vitest';
import { closeDepthField } from './wood-view-flatten';

// A 7x7 field: a flat top with a 5x5 groove cut to -4 mm, and one uncut cell
// left standing in the middle — the artefact this exists to remove.
function grooveWithSpike(): Float32Array {
  const depth = new Float32Array(49);
  for (let row = 1; row <= 5; row += 1) {
    for (let col = 1; col <= 5; col += 1) depth[row * 7 + col] = -4;
  }
  depth[3 * 7 + 3] = 0; // the spike
  return depth;
}

describe('closeDepthField', () => {
  it('removes an uncut cell standing inside a groove', () => {
    const closed = closeDepthField(grooveWithSpike(), 7, 7);
    expect(closed[3 * 7 + 3]).toBeCloseTo(-4, 6);
  });

  it('keeps the groove floor at its cut depth', () => {
    const closed = closeDepthField(grooveWithSpike(), 7, 7);
    expect(closed[2 * 7 + 2]).toBeCloseTo(-4, 6);
    expect(closed[4 * 7 + 4]).toBeCloseTo(-4, 6);
  });

  // The clamp against the source is what stops the erosion pass lifting the rim
  // and reporting stock that was actually cut away as still standing.
  it('never reports a cell shallower than it was cut', () => {
    const source = grooveWithSpike();
    const closed = closeDepthField(source, 7, 7);
    for (let i = 0; i < source.length; i += 1) {
      expect(closed[i] ?? 0).toBeLessThanOrEqual((source[i] ?? 0) + 1e-9);
    }
  });

  it('leaves uncut stock untouched', () => {
    const closed = closeDepthField(grooveWithSpike(), 7, 7);
    expect(closed[0]).toBeCloseTo(0, 6);
    expect(closed[6 * 7 + 6]).toBeCloseTo(0, 6);
  });

  it('leaves an already-smooth field unchanged', () => {
    const flat = new Float32Array(49).fill(-2);
    const closed = closeDepthField(flat, 7, 7);
    for (const value of closed) expect(value).toBeCloseTo(-2, 6);
  });
});
