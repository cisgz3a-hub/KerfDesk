import { describe, expect, it } from 'vitest';

import { adjustPotraceVertices } from './potrace-polygon-adjust';
import type { PotracePoint } from './potrace-polygon-core';

describe('adjustPotraceVertices', () => {
  it('keeps a degenerate collinear vertex anchored to its raw cell', () => {
    const points: PotracePoint[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ];

    const vertices = adjustPotraceVertices(points, [0, 1, 2, 3, 4]);

    expect(vertices[1]?.x).toBeCloseTo(2);
    expect(vertices[1]?.y).toBeCloseTo(0);
  });
});
