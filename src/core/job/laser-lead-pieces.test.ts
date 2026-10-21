// Which rings of one scene contour are one part (ADR-626 Amd 6): decided by
// containment, so pieces whose bounds interlock stay apart.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { leadOutline } from './laser-lead-copies';
import type { LeadRing } from './laser-lead-obstacles';
import { pieceExemptions, pieceLookup } from './laser-lead-pieces';

function ring(points: ReadonlyArray<Vec2>, source = 'bar'): LeadRing {
  const closed = [...points, points[0] as Vec2];
  return { ...leadOutline(closed), lineIds: [], source };
}

// An L along the left and bottom of a 10 mm box.
const L_SHAPE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 10 },
  { x: 0, y: 10 },
];

describe('kerf pieces of one contour (ADR-626)', () => {
  it('pairs a piece with the ring it lies in, not with one whose bounds hold it', () => {
    const rings = [
      // Operation 0: the L.
      ring(L_SHAPE),
      // Operation 1: the same L 0.1 mm smaller, and a square in the L's
      // corner, inside the L's bounds but not inside the L.
      ring([
        { x: 0.1, y: 0.1 },
        { x: 9.9, y: 0.1 },
        { x: 9.9, y: 1.9 },
        { x: 1.9, y: 1.9 },
        { x: 1.9, y: 9.9 },
        { x: 0.1, y: 9.9 },
      ]),
      ring([
        { x: 3, y: 3 },
        { x: 10, y: 3 },
        { x: 10, y: 10 },
        { x: 3, y: 10 },
      ]),
    ];
    const exempt = pieceExemptions(rings, [0, 1, 1], [[], [], []], pieceLookup(rings));
    expect(exempt[0]).toEqual([1]);
    expect(exempt[1]).toEqual([0]);
    expect(exempt[2]).toEqual([]);
  });

  it('never pairs rings of different scene contours or of one operation', () => {
    const rings = [
      ring(L_SHAPE),
      ring(
        L_SHAPE.map((point) => ({ x: point.x * 0.99 + 0.05, y: point.y * 0.99 + 0.05 })),
        'other',
      ),
      ring(L_SHAPE.map((point) => ({ x: point.x * 0.99 + 0.05, y: point.y * 0.99 + 0.05 }))),
    ];
    const exempt = pieceExemptions(rings, [0, 1, 0], [[], [], []], pieceLookup(rings));
    expect(exempt).toEqual([[], [], []]);
  });
});
