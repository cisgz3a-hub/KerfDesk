import { describe, expect, it } from 'vitest';
import { nestedMinsertDxf, nestedMinsertStartX } from '../../__fixtures__/nested-minsert';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import { parseDxf } from './parse-dxf';

const INSTANCES = 150_000;

/** Every straight piece of a curve as [from, to]. */
function pieces(curve: CurveSubpath): Array<readonly [Vec2, Vec2]> {
  let at = curve.start;
  return curve.segments.map((segment) => {
    const piece = [at, segment.to] as const;
    at = segment.to;
    return piece;
  });
}

describe('composed DXF MINSERT expansion', () => {
  it('preserves all 150,000 nested instances and their composed transforms and native curves', () => {
    const dxfText = nestedMinsertDxf();
    expect(dxfText.length).toBeLessThan(500);
    const result = parseDxf({ dxfText, id: 'nested', source: 'nested.dxf' });
    if (result.kind !== 'ok' || result.object === null)
      throw new Error('Expected imported geometry');
    expect(result.notes).toEqual([]);
    expect(result.skippedSummary).toBeNull();
    expect(result.object.paths).toHaveLength(1);
    const path = result.object.paths[0];
    expect(path?.color).toBe('#ff0000');
    const curves = path?.curves ?? [];
    // Instances whose ends happen to meet exactly one other end are joined on
    // import (ADR-626 Amendment 8), so a path may hold more than one; every
    // instance is still there, as one 4 mm line piece.
    expect(path?.polylines).toHaveLength(curves.length);
    expect(result.pathCount).toBe(curves.length);
    expect(curves.length).toBeLessThan(INSTANCES);
    expect(curves.every((curve) => !curve.closed)).toBe(true);
    expect(
      curves.every((curve) => curve.segments.every((segment) => segment.kind === 'line')),
    ).toBe(true);
    const all = curves.flatMap(pieces);
    expect(all).toHaveLength(INSTANCES);
    const straight = all.every(
      ([from, to]) =>
        Math.abs(from.y) < 1e-8 &&
        Math.abs(to.y) < 1e-8 &&
        Math.abs(Math.abs(from.x - to.x) - 4) < 1e-8,
    );
    expect(straight).toBe(true);
    const starts = all.map(([from, to]) => Math.max(from.x, to.x)).sort((a, b) => a - b);
    const expected = Array.from({ length: INSTANCES }, (_, index) =>
      nestedMinsertStartX(index),
    ).sort((a, b) => a - b);
    expect(starts.every((x, index) => Math.abs(x - (expected[index] ?? NaN)) < 1e-8)).toBe(true);
    expect(result.object.bounds.maxX).toBeCloseTo(6986, 8);
    expect(result.object.bounds.maxY).toBeCloseTo(0, 8);
    // About 3.3 s alone on a dev box, and longer beside other test runs. The test
    // says the instances expand correctly, not how fast, so only a hang trips it.
  }, 30_000);
});
