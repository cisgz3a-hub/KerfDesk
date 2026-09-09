import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, polylineToCurveSubpath, type Polyline } from '../../core/scene';
import { fairTracedPathsForCnc } from './cnc-trace-fairing';

const RECEIVER: Polyline = {
  closed: false,
  points: Array.from({ length: 41 }, (_, x) => ({ x, y: x % 2 === 0 ? 0.3 : -0.3 })),
};
const PLACEMENTS = [
  { ...IDENTITY_TRANSFORM, scaleX: 0.1, scaleY: 0.1 },
  { ...IDENTITY_TRANSFORM, scaleX: 0.213, scaleY: 0.137, rotationDeg: 17, mirrorX: true },
];

function branch(x: number, y: number): Polyline {
  return {
    closed: false,
    points: [
      { x, y: y + 12 },
      { x, y },
    ],
  };
}

function conditioned(polylines: Polyline[], placement = PLACEMENTS[0]!) {
  const paths = fairTracedPathsForCnc([{ color: '#000000', polylines }], placement);
  const path = paths[0];
  if (path === undefined) throw new Error('Expected one colour path');
  expect(path.curves).toEqual(path.polylines.map(polylineToCurveSubpath));
  return path.polylines;
}

describe('CNC trace contacts', () => {
  for (const placement of PLACEMENTS) {
    it(`keeps both receiving contacts at ${placement.scaleX}/${placement.scaleY}`, () => {
      const polylines = [RECEIVER, branch(10, 0.3), branch(30, 0.3)];
      const result = conditioned(polylines, placement);
      expect(result).toHaveLength(3);
      for (const x of [10, 30]) {
        expect(result[0]?.points.some((p) => Math.abs(p.x - x) < 1e-12 && p.y === 0.3)).toBe(true);
      }
      expect(result[0]?.points).not.toEqual(RECEIVER.points);
      if (placement.scaleX === 0.1) {
        expect(result[0]?.points.length).toBeLessThan(RECEIVER.points.length);
      }
    });
  }

  it('inserts and retains an attachment inside a receiving segment', () => {
    const result = conditioned([RECEIVER, branch(10.5, 0)]);
    expect(result[0]?.points).toContainEqual({ x: 10.5, y: 0 });
  });

  it('keeps a closed-ring attachment away from the seam', () => {
    const points = Array.from({ length: 80 }, (_, i) => ({
      x: 20 * Math.cos((i * Math.PI) / 40),
      y: 20 * Math.sin((i * Math.PI) / 40),
    }));
    const contact = points[20]!;
    const result = conditioned([
      { closed: true, points: [...points, { ...points[0]! }] },
      { closed: false, points: [{ x: contact.x, y: 40 }, { ...contact }] },
    ]);
    expect(result[0]?.points).toContainEqual(contact);
    expect(result[0]?.closed).toBe(true);
  });

  it('keeps the same junctions after receiver reversal and input permutation', () => {
    const result = conditioned([
      branch(30, 0.3),
      { ...RECEIVER, points: [...RECEIVER.points].reverse() },
      branch(10, 0.3),
    ]);
    expect(result[1]?.points).toContainEqual({ x: 10, y: 0.3 });
    expect(result[1]?.points).toContainEqual({ x: 30, y: 0.3 });
  });

  it('leaves a nearby separate stroke independent and preserves useful fairing', () => {
    const alone = conditioned([RECEIVER]);
    const separate = conditioned([RECEIVER, branch(10, 0.300000001)]);
    expect(separate).toHaveLength(2);
    expect(separate[0]).toEqual(alone[0]);
  });

  it('preserves contacts across colour paths without welding their ownership', () => {
    const result = fairTracedPathsForCnc(
      [
        { color: '#000000', polylines: [RECEIVER] },
        { color: '#ff0000', polylines: [branch(10, 0.3)] },
      ],
      PLACEMENTS[0]!,
    );
    expect(result.map((path) => path.color)).toEqual(['#000000', '#ff0000']);
    expect(result[0]?.polylines[0]?.points).toContainEqual({ x: 10, y: 0.3 });
  });

  it('retains a contact at a nearly coincident endpoint consumed by a weld', () => {
    const contact = { x: 10 + 1e-10, y: 1e-10 };
    const left = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const right = { closed: false, points: [contact, { x: 15, y: 1 }, { x: 20, y: 2 }] };
    const result = conditioned([left, right, branch(contact.x, contact.y)]);
    expect(result).toHaveLength(2);
    expect(result[0]?.points).toContainEqual(contact);
  });
});
