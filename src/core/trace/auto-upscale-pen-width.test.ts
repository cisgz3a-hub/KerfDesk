// Line + fill (ADR-443) pen widths through downscaleTracedPaths. Split from
// auto-upscale.test.ts to keep that file under the line cap.

import { describe, expect, it } from 'vitest';

import { downscaleTracedPaths } from './auto-upscale';

describe('downscaleTracedPaths pen widths', () => {
  it('scales a Line + fill pen width with the coordinates and omits an absent one', () => {
    const line = {
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
      ],
      closed: false,
    };
    const [pen, plain] = downscaleTracedPaths(
      [
        { color: '#0000ff', polylines: [line], strokeWidthMm: 6 },
        { color: '#000000', polylines: [line] },
      ],
      2,
    );
    expect(pen?.strokeWidthMm).toBe(3);
    expect(plain !== undefined && 'strokeWidthMm' in plain).toBe(false);
  });
});
