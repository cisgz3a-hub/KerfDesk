import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene/scene-object';
import { reliefVectorFootprintCovered } from './relief-vector-footprint';

const rectangle = (x: number, y: number, width: number, height: number) => ({
  closed: true,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});
const cell = rectangle(2, 2, 1, 1).points;
describe('whole source-cell vector inclusion', () => {
  it('preserves an aligned included edge but excludes a fractionally crossed edge', () => {
    expect(reliefVectorFootprintCovered({ rings: [rectangle(2, 2, 6, 6)] }, cell)).toBe(true);
    expect(reliefVectorFootprintCovered({ rings: [rectangle(2.2, 2.2, 5.6, 5.6)] }, cell)).toBe(
      false,
    );
  });
  it('sees a sub-cell hole even when its four corners and centre remain included', () => {
    const rings = [rectangle(0, 0, 10, 10), rectangle(2.1, 2.1, 0.2, 0.2)];
    expect(reliefVectorFootprintCovered({ rings }, cell)).toBe(false);
  });
  it('excludes a cell exactly occupying a hole, whose corners all lie on its boundary', () => {
    expect(
      reliefVectorFootprintCovered(
        { rings: [rectangle(0, 0, 10, 10), rectangle(2, 2, 1, 1)] },
        cell,
      ),
    ).toBe(false);
  });
  it('sees a concave notch crossing the middle of a cell', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 2.7, y: 10 },
      { x: 2.7, y: 2.1 },
      { x: 2.6, y: 2.1 },
      { x: 2.6, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(reliefVectorFootprintCovered({ rings: [{ closed: true, points }] }, cell)).toBe(false);
  });
  it('checks a rotated non-uniform footprint without treating its bounding box as the cell', () => {
    const turn = (p: Vec2) => ({ x: 5 + 2 * p.x - p.y, y: 4 + p.x + 2 * p.y });
    const points = rectangle(0, 0, 4, 4).points.map(turn);
    expect(
      reliefVectorFootprintCovered(
        { rings: [{ closed: true, points }] },
        rectangle(0, 0, 1, 1).points.map(turn),
      ),
    ).toBe(true);
  });
});
