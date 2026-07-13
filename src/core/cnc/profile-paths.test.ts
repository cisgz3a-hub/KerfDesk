import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { profileToolpathPolylines } from './profile-paths';

const TOOL_DIAMETER_MM = 2; // radius 1 — easy arithmetic

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function span(polyline: Polyline): number {
  const xs = polyline.points.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

describe('profileToolpathPolylines', () => {
  it('offsets outward by the tool radius for outside profiles', () => {
    const out = profileToolpathPolylines([square(0, 0, 20)], 'outside', TOOL_DIAMETER_MM);
    expect(out).toHaveLength(1);
    expect(span(out[0] as Polyline)).toBeCloseTo(22, 6);
  });

  it('offsets inward by the tool radius for inside profiles', () => {
    const out = profileToolpathPolylines([square(0, 0, 20)], 'inside', TOOL_DIAMETER_MM);
    expect(out).toHaveLength(1);
    expect(span(out[0] as Polyline)).toBeCloseTo(18, 6);
  });

  it('keeps geometry unchanged for on-path profiles', () => {
    const source = square(0, 0, 20);
    const out = profileToolpathPolylines([source], 'on-path', TOOL_DIAMETER_MM);
    expect(out).toHaveLength(1);
    expect(span(out[0] as Polyline)).toBeCloseTo(20, 6);
  });

  it('shrinks holes when offsetting outside, so part AND hole keep size', () => {
    const outer = square(0, 0, 20);
    const hole = square(5, 5, 10);
    const out = profileToolpathPolylines([outer, hole], 'outside', TOOL_DIAMETER_MM);
    expect(out).toHaveLength(2);
    const spans = out.map(span).sort((a, b) => a - b);
    expect(spans[0]).toBeCloseTo(8, 6); // hole toolpath INSIDE the hole boundary
    expect(spans[1]).toBeCloseTo(22, 6); // outer toolpath outside the boundary
  });

  it('cuts open polylines on-path regardless of the requested side', () => {
    const open: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const out = profileToolpathPolylines([open], 'outside', TOOL_DIAMETER_MM);
    expect(out).toHaveLength(1);
    expect(out[0]?.points).toEqual(open.points);
    expect(out[0]?.closed).toBe(false);
  });

  it('drops degenerate polylines', () => {
    const dot: Polyline = { closed: false, points: [{ x: 1, y: 1 }] };
    expect(profileToolpathPolylines([dot], 'outside', TOOL_DIAMETER_MM)).toHaveLength(0);
  });

  it('offsets outward by radius + allowance when a finish allowance is set (outside)', () => {
    // radius 1 + allowance 3 → 4 per side → 20 + 8 = 28 span (stays proud).
    const out = profileToolpathPolylines([square(0, 0, 20)], 'outside', TOOL_DIAMETER_MM, 3);
    expect(span(out[0] as Polyline)).toBeCloseTo(28, 6);
  });

  it('offsets inward by radius + allowance when a finish allowance is set (inside)', () => {
    const out = profileToolpathPolylines([square(0, 0, 20)], 'inside', TOOL_DIAMETER_MM, 3);
    expect(span(out[0] as Polyline)).toBeCloseTo(12, 6);
  });

  it('ignores the finish allowance for on-path profiles (always centered)', () => {
    const out = profileToolpathPolylines([square(0, 0, 20)], 'on-path', TOOL_DIAMETER_MM, 3);
    expect(span(out[0] as Polyline)).toBeCloseTo(20, 6);
  });

  it('is identical to the no-allowance call when the allowance is 0 (determinism #5)', () => {
    const source = [square(0, 0, 20), square(5, 5, 10)];
    expect(profileToolpathPolylines(source, 'outside', TOOL_DIAMETER_MM, 0)).toEqual(
      profileToolpathPolylines(source, 'outside', TOOL_DIAMETER_MM),
    );
  });
});
