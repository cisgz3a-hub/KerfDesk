import { describe, expect, it } from 'vitest';
import {
  holdsEveryNestedMinsertInstance,
  NESTED_MINSERT_INSTANCES,
  nestedMinsertDxf,
} from '../../__fixtures__/nested-minsert';
import { parseDxf } from './parse-dxf';

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
    // Instances whose ends meet exactly one other end are joined on import
    // (ADR-626 Amendment 8), so there are fewer paths than instances; every
    // instance is still there, as one line piece.
    expect(path?.polylines).toHaveLength(curves.length);
    expect(result.pathCount).toBe(curves.length);
    expect(curves.length).toBeLessThan(NESTED_MINSERT_INSTANCES);
    expect(curves.every((curve) => !curve.closed)).toBe(true);
    expect(holdsEveryNestedMinsertInstance(curves)).toBe(true);
    expect(result.object.bounds.maxX).toBeCloseTo(6986, 8);
    expect(result.object.bounds.maxY).toBeCloseTo(0, 8);
    // About 3.3 s alone on a dev box, and longer beside other test runs. The test
    // says the instances expand correctly, not how fast, so only a hang trips it.
  }, 30_000);
});
