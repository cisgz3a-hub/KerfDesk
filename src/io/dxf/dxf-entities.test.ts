import { describe, expect, it } from 'vitest';

import { parseDxf } from './parse-dxf';

function tags(...pairs: ReadonlyArray<readonly [number, string]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function periodicSplineDxf(): string {
  return [
    tags([0, 'SECTION'], [2, 'ENTITIES']),
    tags(
      [0, 'SPLINE'],
      [70, '2'],
      [71, '2'],
      [40, '0'],
      [40, '0'],
      [40, '0'],
      [40, '1'],
      [40, '1'],
      [40, '1'],
      [10, '0'],
      [20, '0'],
      [10, '10'],
      [20, '0'],
      [10, '0'],
      [20, '0'],
    ),
    tags([0, 'ENDSEC']),
    tags([0, 'EOF']),
    '',
  ].join('\n');
}

describe('splineToPolyline', () => {
  it('preserves Autodesk periodic group-70 bit 2 as closed topology', () => {
    const result = parseDxf({
      dxfText: periodicSplineDxf(),
      id: 'periodic',
      source: 'periodic.dxf',
    });
    if (result.kind !== 'ok' || result.object === null)
      throw new Error('periodic spline did not import');
    expect(result.object.paths[0]?.polylines[0]?.closed).toBe(true);
  });
});
