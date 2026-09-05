import { describe, expect, it } from 'vitest';
import { nestedMinsertDxf, nestedMinsertStartX } from '../../__fixtures__/nested-minsert';
import { parseDxf } from './parse-dxf';

describe('composed DXF MINSERT expansion', () => {
  it('preserves all 150,000 nested instances and their composed transforms and native curves', () => {
    const dxfText = nestedMinsertDxf();
    expect(dxfText.length).toBeLessThan(500);
    const result = parseDxf({ dxfText, id: 'nested', source: 'nested.dxf' });
    if (result.kind !== 'ok' || result.object === null)
      throw new Error('Expected imported geometry');
    expect(result.pathCount).toBe(150_000);
    expect(result.notes).toEqual([]);
    expect(result.skippedSummary).toBeNull();
    expect(result.object.paths).toHaveLength(1);
    const path = result.object.paths[0];
    expect(path?.color).toBe('#ff0000');
    expect(path?.polylines).toHaveLength(150_000);
    expect(path?.curves).toHaveLength(150_000);
    expect(
      path?.polylines.every((line, index) => {
        const from = line.points[0],
          to = line.points[1];
        const x = nestedMinsertStartX(index);
        return (
          !line.closed &&
          line.points.length === 2 &&
          from !== undefined &&
          to !== undefined &&
          Math.abs(from.x - x) < 1e-8 &&
          Math.abs(to.x - (x - 4)) < 1e-8 &&
          Math.abs(from.y) < 1e-8 &&
          Math.abs(to.y) < 1e-8
        );
      }),
    ).toBe(true);
    expect(
      path?.curves?.every((curve, index) => {
        const segment = curve.segments[0],
          x = nestedMinsertStartX(index);
        return (
          !curve.closed &&
          curve.segments.length === 1 &&
          segment?.kind === 'line' &&
          Math.abs(curve.start.x - x) < 1e-8 &&
          Math.abs(segment.to.x - (x - 4)) < 1e-8 &&
          Math.abs(curve.start.y) < 1e-8 &&
          Math.abs(segment.to.y) < 1e-8
        );
      }),
    ).toBe(true);
    expect(result.object.bounds.maxX).toBeCloseTo(6986, 8);
    expect(result.object.bounds.maxY).toBeCloseTo(0, 8);
  });
});
