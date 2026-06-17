import { describe, expect, it } from 'vitest';
import { frameBoundsSignature } from './frame-verification';

describe('frameBoundsSignature', () => {
  it('is a deterministic function of the four bounds', () => {
    const sig = frameBoundsSignature({ minX: 10, minY: 5, maxX: 60, maxY: 45 });
    expect(sig).toBe('10,5,60,45');
    expect(frameBoundsSignature({ minX: 10, minY: 5, maxX: 60, maxY: 45 })).toBe(sig);
  });

  it('rounds to 3 dp so float noise does not force a re-frame', () => {
    const a = frameBoundsSignature({ minX: 0.1 + 0.2, minY: 0, maxX: 50, maxY: 50 });
    const b = frameBoundsSignature({ minX: 0.3, minY: 0, maxX: 50, maxY: 50 });
    expect(a).toBe(b);
  });

  it('differs when the rectangle moves or resizes', () => {
    const base = frameBoundsSignature({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
    expect(frameBoundsSignature({ minX: 1, minY: 0, maxX: 51, maxY: 50 })).not.toBe(base); // moved
    expect(frameBoundsSignature({ minX: 0, minY: 0, maxX: 60, maxY: 50 })).not.toBe(base); // resized
  });
});
