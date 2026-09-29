import { describe, expect, it } from 'vitest';

import { parseDxf } from './parse-dxf';

function tags(...pairs: ReadonlyArray<readonly [number, string | number]>): string {
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

function entitiesDxf(...entities: ReadonlyArray<string>): string {
  return [
    tags([0, 'SECTION'], [2, 'ENTITIES']),
    ...entities,
    tags([0, 'ENDSEC']),
    tags([0, 'EOF']),
  ].join('\n');
}

function importedPaths(dxfText: string) {
  const result = parseDxf({ dxfText, id: 'entities', source: 'entities.dxf' });
  if (result.kind !== 'ok' || result.object === null) throw new Error('nothing imported');
  return result.object.paths;
}

function vertex(x: number, y: number, flags = 0): string {
  return tags([0, 'VERTEX'], [10, x], [20, y], [70, flags]);
}

describe('polylineEntityToPolyline', () => {
  it('draws a spline-fit POLYLINE through its fitted vertices, not its frame', () => {
    // Written by ezdxf 1.4.4 R12Spline: fitted vertices (flag 8), then the
    // spline frame control points (flag 16), as AutoCAD writes them.
    const fitted = [
      [0, 0],
      [5.7407, 6.2963],
      [12.5926, 7.037],
      [20, 5],
      [27.4074, 2.963],
      [34.2593, 3.7037],
      [40, 10],
    ] as const;
    const frame = [
      [0, 0],
      [10, 20],
      [30, -10],
      [40, 10],
    ] as const;
    const paths = importedPaths(
      entitiesDxf(
        tags([0, 'POLYLINE'], [66, 1], [70, 4]),
        ...fitted.map(([x, y]) => vertex(x, y, 8)),
        ...frame.map(([x, y]) => vertex(x, y, 16)),
        tags([0, 'SEQEND']),
      ),
    );
    const points = paths[0]?.polylines[0]?.points ?? [];
    expect(points).toHaveLength(fitted.length);
    points.forEach((point, index) => {
      const [x, y] = fitted[index]!;
      // parse-dxf flips Y about the top edge (y 10) and keeps x from 0.
      expect(point.x).toBeCloseTo(x, 9);
      expect(10 - point.y).toBeCloseTo(y, 9);
    });
  });
});

// Exporters often close an outline by repeating its first vertex without the
// closed flag; it must import exactly as the flagged outline does.
describe('outlines whose ends meet without the closed flag', () => {
  const square = [
    [0, 0],
    [40, 0],
    [40, 20],
    [0, 20],
  ] as const;

  function lwpolyline(flags: number, corners: ReadonlyArray<readonly [number, number]>): string {
    const coords = corners.flatMap(([x, y]) => [[10, x] as const, [20, y] as const]);
    return tags([0, 'LWPOLYLINE'], [90, corners.length], [70, flags], ...coords);
  }

  it('closes an LWPOLYLINE that repeats its first vertex', () => {
    const flagged = importedPaths(entitiesDxf(lwpolyline(1, square)));
    const repeated = importedPaths(entitiesDxf(lwpolyline(0, [...square, [0, 0]])));
    expect(repeated).toEqual(flagged);
    expect(repeated[0]?.polylines[0]).toMatchObject({ closed: true });
    expect(repeated[0]?.polylines[0]?.points).toHaveLength(4);
    expect(repeated[0]?.curves?.[0]).toMatchObject({ closed: true });
  });

  it('closes a classic POLYLINE that repeats its first vertex, bulges included', () => {
    const polyline = (flags: number, corners: ReadonlyArray<readonly [number, number]>) =>
      [
        tags([0, 'POLYLINE'], [66, 1], [70, flags]),
        ...corners.map(([x, y], index) =>
          index === 3 ? tags([0, 'VERTEX'], [10, x], [20, y], [42, 0.5]) : vertex(x, y),
        ),
        tags([0, 'SEQEND']),
      ].join('\n');
    const flagged = importedPaths(entitiesDxf(polyline(1, square)));
    const repeated = importedPaths(entitiesDxf(polyline(0, [...square, [0, 0]])));
    expect(repeated).toEqual(flagged);
    expect(repeated[0]?.polylines[0]?.closed).toBe(true);
  });

  it('closes a SPLINE whose ends coincide', () => {
    const spline = (flags: number) =>
      tags(
        [0, 'SPLINE'],
        [70, flags],
        [71, 1],
        ...[0, 0, 1, 2, 3, 4, 4].map((knot) => [40, knot] as const),
        ...[...square, [0, 0] as const].flatMap(([x, y]) => [[10, x] as const, [20, y] as const]),
      );
    const flagged = importedPaths(entitiesDxf(spline(8 | 1)));
    const coincident = importedPaths(entitiesDxf(spline(8)));
    expect(coincident).toEqual(flagged);
    const points = coincident[0]?.polylines[0]?.points ?? [];
    expect(coincident[0]?.polylines[0]?.closed).toBe(true);
    // Stored like the flagged spline: the end does not repeat the start.
    expect(points.at(-1)).not.toEqual(points[0]);
  });

  it('leaves an outline open when its ends are more than 0.0001 mm apart in mm', () => {
    const almost = importedPaths(entitiesDxf(lwpolyline(0, [...square, [0, 0.0002]])));
    expect(almost[0]?.polylines[0]).toMatchObject({ closed: false });
    expect(almost[0]?.polylines[0]?.points).toHaveLength(5);
  });

  it('measures the gap after unit scaling', () => {
    const inchHeader = [
      tags([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 1]),
      tags([0, 'ENDSEC']),
    ].join('\n');
    // 0.00005 in is 0.00127 mm: too far apart to be one outline.
    const inches = importedPaths(
      `${inchHeader}\n${entitiesDxf(lwpolyline(0, [...square, [0, 0.00005]]))}`,
    );
    expect(inches[0]?.polylines[0]?.closed).toBe(false);
    const millimeters = importedPaths(entitiesDxf(lwpolyline(0, [...square, [0, 0.00005]])));
    expect(millimeters[0]?.polylines[0]?.closed).toBe(true);
  });
});
