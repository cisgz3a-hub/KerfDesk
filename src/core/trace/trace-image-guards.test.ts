// Malformed-buffer and non-finite-adjustment guards for the trace preprocessing
// core (audit findings D-S05-002 and D-S05-004). Split out of trace-image.test.ts
// to keep that file under the max-lines cap.

import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACE_OPTIONS, isValidRawImageData, preprocessForTrace } from './trace-image';

describe('preprocessForTrace input guards', () => {
  it('isValidRawImageData accepts a well-formed buffer', () => {
    // 2x2 RGBA => data.length must be 2*2*4 = 16.
    const data = new Uint8ClampedArray(16);
    expect(isValidRawImageData({ width: 2, height: 2, data })).toBe(true);
  });

  it('isValidRawImageData rejects a wrong data length', () => {
    // Declared 2x2 (needs 16 bytes) but the buffer is short.
    const data = new Uint8ClampedArray(12);
    expect(isValidRawImageData({ width: 2, height: 2, data })).toBe(false);
  });

  it('isValidRawImageData rejects non-integer / non-positive dimensions', () => {
    const data = new Uint8ClampedArray(16);
    expect(isValidRawImageData({ width: 2.5, height: 2, data })).toBe(false);
    expect(isValidRawImageData({ width: 0, height: 2, data })).toBe(false);
    expect(
      isValidRawImageData({ width: Number.NaN, height: 2, data: new Uint8ClampedArray(0) }),
    ).toBe(false);
  });

  it('preprocessForTrace fails closed (returns input unchanged) on a malformed image', () => {
    // Declared 2x2 but only 12 bytes of data — a shape guard must short-circuit
    // rather than let downstream stages read past the buffer.
    const data = new Uint8ClampedArray(12);
    const malformed = { width: 2, height: 2, data };
    const result = preprocessForTrace(malformed, DEFAULT_TRACE_OPTIONS);
    expect(result).toBe(malformed);
  });

  it('non-finite brightness/contrast/gamma are treated as no-ops (no silent blackening)', () => {
    // Solid mid-grey 2x1 image, thresholding disabled so we observe the raw
    // adjusted pixels. NaN/Infinity brightness/contrast used to clamp every
    // channel to 0 (black); non-finite gamma likewise. They must now no-op.
    function grey(): { width: number; height: number; data: Uint8ClampedArray } {
      return {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([120, 120, 120, 255, 120, 120, 120, 255]),
      };
    }
    const base = {
      numberOfColors: 2,
      pathOmit: 8,
      lineTolerance: 1,
      quadraticTolerance: 1,
      blurRadius: 0,
      blurDelta: 0,
      lineFilter: false,
    } as const;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Array.from(preprocessForTrace(grey(), { ...base, brightness: bad }).data)).toEqual(
        Array.from(grey().data),
      );
      expect(Array.from(preprocessForTrace(grey(), { ...base, contrast: bad }).data)).toEqual(
        Array.from(grey().data),
      );
      expect(Array.from(preprocessForTrace(grey(), { ...base, gamma: bad }).data)).toEqual(
        Array.from(grey().data),
      );
    }
  });
});
