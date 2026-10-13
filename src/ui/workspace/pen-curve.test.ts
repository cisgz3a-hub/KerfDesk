import { describe, expect, it } from 'vitest';
import { penContour, penHasHandles } from './pen-curve';

const V = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

describe('penContour', () => {
  it('keeps plain clicks straight and makes a dragged node smooth', () => {
    const contour = penContour(V, [null, { x: 14, y: 0 }, null], false);
    expect(contour?.segments).toEqual([
      // Into the dragged node: its incoming handle mirrors the outgoing one.
      { kind: 'cubic', control1: { x: 0, y: 0 }, control2: { x: 6, y: 0 }, to: { x: 10, y: 0 } },
      {
        kind: 'cubic',
        control1: { x: 14, y: 0 },
        control2: { x: 10, y: 10 },
        to: { x: 10, y: 10 },
      },
    ]);
    expect(penContour(V, [], true)?.segments.map((segment) => segment.kind)).toEqual([
      'line',
      'line',
      'line',
    ]);
    expect(penHasHandles([null, undefined])).toBe(false);
  });
});
