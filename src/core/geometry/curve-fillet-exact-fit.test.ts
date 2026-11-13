// Tools audit T1, T11: a radius that exactly fills a side rounds every corner
// (T11-P2-1); Remove with nothing picked leaves a very sharp rounded tip alone
// instead of growing it into a spike (T11-P2-2), and with nodes picked changes
// only the picked fillet (T11R-P2-1).
import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath, type CurveSubpath, type Vec2 } from '../scene';
import { filletCurveCorners, removeCurveFillets } from './curve-fillet';

function rectangle(width: number, height: number): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: width, y: 0 } },
      { kind: 'line', to: { x: width, y: height } },
      { kind: 'line', to: { x: 0, y: height } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
    closed: true,
  };
}

function length(curve: CurveSubpath): number {
  const result = flattenCurveSubpath(curve, { toleranceMm: 0.001 });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  const points: ReadonlyArray<Vec2> = result.polyline.points;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

describe('a radius that exactly fills a side (T11-P2-1)', () => {
  it('turns a 10 mm square at r 5 into a circle', () => {
    const result = filletCurveCorners(rectangle(10, 10), 5, 'round');
    expect(result?.count).toBe(4);
    const curve = result?.curve;
    if (curve === undefined) throw new Error('no result');
    expect(curve.segments.every((segment) => segment.kind === 'elliptical-arc')).toBe(true);
    expect(length(curve)).toBeCloseTo(2 * Math.PI * 5, 2);
  });

  it('turns a 30 × 10 slot at r 5 into a stadium', () => {
    const result = filletCurveCorners(rectangle(30, 10), 5, 'round');
    expect(result?.count).toBe(4);
    if (result === null) throw new Error('no result');
    expect(length(result.curve)).toBeCloseTo(2 * Math.PI * 5 + 40, 2);
  });

  it('rounds all corners of a 1 × ½ in plate at r ¼ in', () => {
    const result = filletCurveCorners(rectangle(25.4, 12.7), 6.35, 'round');
    expect(result?.count).toBe(4);
    if (result === null) throw new Error('no result');
    expect(length(result.curve)).toBeCloseTo(2 * Math.PI * 6.35 + 2 * 12.7, 2);
  });

  it('bites all four corners of a 10 mm square at reverse r 5', () => {
    expect(filletCurveCorners(rectangle(10, 10), 5, 'reverse')?.count).toBe(4);
  });

  it('still leaves every corner sharp when the radius is too large', () => {
    expect(filletCurveCorners(rectangle(10, 10), 5.001, 'round')).toBeNull();
  });
});

// A long isosceles tip with a 2° point, rounded at r 4.5: the rounded end of
// a tapered slot.
function roundedTip(): CurveSubpath {
  const half = 300 * Math.tan(Math.PI / 180);
  const tip: CurveSubpath = {
    start: { x: 0, y: -half },
    segments: [
      { kind: 'line', to: { x: 300, y: 0 } },
      { kind: 'line', to: { x: 0, y: half } },
      { kind: 'line', to: { x: 0, y: -half } },
    ],
    closed: true,
  };
  const rounded = filletCurveCorners(tip, 4.5, 'round', [1]);
  if (rounded === null) throw new Error('tip not rounded');
  return rounded.curve;
}

describe('Remove fillets (T11-P2-2, T11R-P2-1)', () => {
  it('leaves a very sharp rounded tip alone when nothing is picked', () => {
    expect(removeCurveFillets(roundedTip())).toBeNull();
  });

  it('restores the tip when its arc is picked', () => {
    const curve = roundedTip();
    const arcIndex = curve.segments.findIndex((segment) => segment.kind === 'elliptical-arc');
    const restored = removeCurveFillets(curve, [arcIndex]);
    expect(restored?.count).toBe(1);
    const xs = restored?.curve.segments.map((segment) => segment.to.x) ?? [];
    expect(Math.max(...xs)).toBeCloseTo(300, 6);
  });

  it('still sharpens every ordinary fillet when nothing is picked', () => {
    const rounded = filletCurveCorners(rectangle(40, 20), 3, 'round');
    if (rounded === null) throw new Error('not rounded');
    expect(removeCurveFillets(rounded.curve)?.count).toBe(4);
  });

  it('sharpens only the picked fillet', () => {
    const rounded = filletCurveCorners(rectangle(40, 20), 3, 'round');
    if (rounded === null) throw new Error('not rounded');
    const arcIndex = rounded.curve.segments.findIndex(
      (segment) => segment.kind === 'elliptical-arc',
    );
    // The arc's end node is picked, as the node tool reports it.
    expect(removeCurveFillets(rounded.curve, [arcIndex + 1])?.count).toBe(1);
  });
});
