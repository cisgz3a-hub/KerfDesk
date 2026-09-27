import { describe, expect, it } from 'vitest';
import { savedMarkErrors } from './camera-model-accuracy';

describe('savedMarkErrors', () => {
  it('keeps each ring to the micrometre and marks only the rejected ones', () => {
    expect(
      savedMarkErrors([
        { x: 25, y: 45, dxMm: 0.123456, dyMm: -0.0004, rejected: false },
        { x: 65, y: 45, dxMm: 2.5, dyMm: 1, rejected: true },
      ]),
    ).toEqual([
      { x: 25, y: 45, dxMm: 0.123, dyMm: -0 },
      { x: 65, y: 45, dxMm: 2.5, dyMm: 1, rejected: true },
    ]);
  });

  it('leaves out a ring the model could not map', () => {
    expect(
      savedMarkErrors([{ x: 25, y: 45, dxMm: Number.NaN, dyMm: Number.NaN, rejected: false }]),
    ).toEqual([]);
  });
});
