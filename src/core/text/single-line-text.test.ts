import { describe, expect, it } from 'vitest';
import { singleLineTextToPolylines } from './single-line-text';

const BASE_INPUT = {
  content: 'IO',
  sizeMm: 21,
  alignment: 'left' as const,
  lineHeight: 1.4,
  letterSpacing: 0,
  color: '#000000',
};

describe('singleLineTextToPolylines', () => {
  it('renders character strokes as open one-tool-pass geometry', () => {
    const rendered = singleLineTextToPolylines(BASE_INPUT);
    const polylines = rendered.paths[0]?.polylines ?? [];

    expect(polylines.length).toBeGreaterThan(0);
    expect(polylines.every((polyline) => !polyline.closed)).toBe(true);
    expect(rendered.paths[0]?.curves?.every((curve) => !curve.closed)).toBe(true);
    expect(rendered.bounds.maxX).toBeGreaterThan(0);
    expect(rendered.bounds.maxY).toBeGreaterThan(0);
  });

  it('keeps an O as one stroke instead of inner and outer outlines', () => {
    const rendered = singleLineTextToPolylines({ ...BASE_INPUT, content: 'O' });

    expect(rendered.paths[0]?.polylines).toHaveLength(1);
  });

  it('reuses tracer curve refinement to round a C instead of drawing coarse chords', () => {
    const rendered = singleLineTextToPolylines({ ...BASE_INPUT, content: 'C' });
    const points = rendered.paths[0]?.polylines[0]?.points ?? [];

    expect(points.length).toBeGreaterThan(30);
    expect(maxInteriorTurnDeg(points)).toBeLessThan(15);
  });

  it('keeps straight construction strokes exact while rounding curved strokes', () => {
    const rendered = singleLineTextToPolylines({ ...BASE_INPUT, content: 'A' });
    const strokes = rendered.paths[0]?.polylines ?? [];

    expect(strokes).toHaveLength(3);
    expect(strokes.every((stroke) => stroke.points.length === 2)).toBe(true);
  });

  it('keeps the refined glyph shape consistent at every text size', () => {
    const small = singleLineTextToPolylines({ ...BASE_INPUT, content: 'C', sizeMm: 7 });
    const large = singleLineTextToPolylines({ ...BASE_INPUT, content: 'C', sizeMm: 42 });
    const smallPoints = small.paths[0]?.polylines[0]?.points ?? [];
    const largePoints = large.paths[0]?.polylines[0]?.points ?? [];

    expect(largePoints).toHaveLength(smallPoints.length);
    largePoints.forEach((point, index) => {
      const smallPoint = smallPoints[index];
      expect(point.x).toBeCloseTo((smallPoint?.x ?? 0) * 6, 10);
      expect(point.y).toBeCloseTo((smallPoint?.y ?? 0) * 6, 10);
    });
  });

  it('aligns shorter lines against the longest line', () => {
    const left = singleLineTextToPolylines({ ...BASE_INPUT, content: 'I\nMMMM' });
    const right = singleLineTextToPolylines({
      ...BASE_INPUT,
      content: 'I\nMMMM',
      alignment: 'right',
    });

    expect(right.paths[0]?.polylines[0]?.points[0]?.x).toBeGreaterThan(
      left.paths[0]?.polylines[0]?.points[0]?.x ?? 0,
    );
  });
});

function maxInteriorTurnDeg(points: ReadonlyArray<{ readonly x: number; readonly y: number }>) {
  let maximum = 0;
  for (let index = 1; index + 1 < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (previous === undefined || current === undefined || next === undefined) continue;
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    if (denominator === 0) continue;
    const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator;
    const turn = (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
    maximum = Math.max(maximum, turn);
  }
  return maximum;
}
