import { describe, expect, it } from 'vitest';
import { parseDxf, type ParseDxfResult } from './parse-dxf';

function tags(...pairs: ReadonlyArray<readonly [number, string]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function dxf(...sections: ReadonlyArray<string>): string {
  return `${sections.join('\n')}\n${tags([0, 'EOF'])}\n`;
}

function entitiesSection(body: string): string {
  return [tags([0, 'SECTION'], [2, 'ENTITIES']), body, tags([0, 'ENDSEC'])].join('\n');
}

function headerSection(body: string): string {
  return [tags([0, 'SECTION'], [2, 'HEADER']), body, tags([0, 'ENDSEC'])].join('\n');
}

function parse(text: string): ParseDxfResult {
  return parseDxf({ dxfText: text, id: 'test-id', source: 'test.dxf' });
}

function okObject(result: ParseDxfResult) {
  if (result.kind !== 'ok') throw new Error(`parse failed: ${result.reason}`);
  if (result.object === null) throw new Error('parse produced no object');
  return result.object;
}

describe('parseDxf entities', () => {
  it('imports a LINE with the Y axis flipped into the canvas frame', () => {
    // DXF is Y-up: (0,0)→(0,10) rises. On the canvas the start must be the
    // LOWER point, i.e. y=10 after the flip-and-normalize.
    const object = okObject(
      parse(dxf(entitiesSection(tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '0'], [21, '10'])))),
    );
    expect(object.paths).toHaveLength(1);
    const polyline = object.paths[0]?.polylines[0];
    expect(polyline?.closed).toBe(false);
    expect(polyline?.points[0]).toEqual({ x: 0, y: 10 });
    expect(polyline?.points[1]).toEqual({ x: 0, y: 0 });
    expect(object.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 10 });
  });

  it('scales inch files to millimeters via $INSUNITS', () => {
    const object = okObject(
      parse(
        dxf(
          headerSection(tags([9, '$INSUNITS'], [70, '1'])),
          entitiesSection(tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '1'], [21, '0'])),
        ),
      ),
    );
    expect(object.bounds.maxX).toBeCloseTo(25.4, 9);
  });

  it('imports a CIRCLE as one closed polyline with 2r × 2r bounds', () => {
    const object = okObject(
      parse(dxf(entitiesSection(tags([0, 'CIRCLE'], [10, '50'], [20, '50'], [40, '10'])))),
    );
    const polyline = object.paths[0]?.polylines[0];
    expect(polyline?.closed).toBe(true);
    expect(object.bounds.maxX).toBeCloseTo(20, 6);
    expect(object.bounds.maxY).toBeCloseTo(20, 6);
  });

  it('imports an ARC counter-clockwise from start to end angle', () => {
    // Quarter arc 0°→90° of r=10 around (0,0): x∈[0,10], y∈[0,10].
    const object = okObject(
      parse(
        dxf(
          entitiesSection(
            tags([0, 'ARC'], [10, '0'], [20, '0'], [40, '10'], [50, '0'], [51, '90']),
          ),
        ),
      ),
    );
    const polyline = object.paths[0]?.polylines[0];
    expect(polyline?.closed).toBe(false);
    expect(object.bounds.maxX).toBeCloseTo(10, 6);
    expect(object.bounds.maxY).toBeCloseTo(10, 6);
  });

  it('imports a closed LWPOLYLINE square and honors a bulge arc', () => {
    const square = okObject(
      parse(
        dxf(
          entitiesSection(
            tags(
              [0, 'LWPOLYLINE'],
              [90, '4'],
              [70, '1'],
              [10, '0'],
              [20, '0'],
              [10, '10'],
              [20, '0'],
              [10, '10'],
              [20, '10'],
              [10, '0'],
              [20, '10'],
            ),
          ),
        ),
      ),
    );
    const squareLine = square.paths[0]?.polylines[0];
    expect(squareLine?.closed).toBe(true);
    expect(squareLine?.points).toHaveLength(4);

    // Semicircular bulge (b=1) on the only segment: sagitta = chord/2 = 5.
    const bulged = okObject(
      parse(
        dxf(
          entitiesSection(
            tags(
              [0, 'LWPOLYLINE'],
              [90, '2'],
              [70, '0'],
              [10, '0'],
              [20, '0'],
              [42, '1'],
              [10, '10'],
              [20, '0'],
            ),
          ),
        ),
      ),
    );
    expect(bulged.bounds.maxY).toBeCloseTo(5, 3);
  });

  it('imports a classic POLYLINE/VERTEX/SEQEND triangle as closed', () => {
    const object = okObject(
      parse(
        dxf(
          entitiesSection(
            [
              tags([0, 'POLYLINE'], [70, '1']),
              tags([0, 'VERTEX'], [10, '0'], [20, '0']),
              tags([0, 'VERTEX'], [10, '10'], [20, '0']),
              tags([0, 'VERTEX'], [10, '5'], [20, '10']),
              tags([0, 'SEQEND']),
            ].join('\n'),
          ),
        ),
      ),
    );
    const polyline = object.paths[0]?.polylines[0];
    expect(polyline?.closed).toBe(true);
    expect(polyline?.points).toHaveLength(3);
  });

  it('imports a full ELLIPSE closed with axis-correct bounds', () => {
    const object = okObject(
      parse(
        dxf(
          entitiesSection(
            tags(
              [0, 'ELLIPSE'],
              [10, '0'],
              [20, '0'],
              [11, '20'],
              [21, '0'],
              [40, '0.5'],
              [41, '0'],
              [42, '6.283185307179586'],
            ),
          ),
        ),
      ),
    );
    const polyline = object.paths[0]?.polylines[0];
    expect(polyline?.closed).toBe(true);
    // Sampled extremes land within the 0.05 mm chord tolerance of the axes.
    expect(Math.abs(object.bounds.maxX - 40)).toBeLessThanOrEqual(0.12);
    expect(Math.abs(object.bounds.maxY - 20)).toBeLessThanOrEqual(0.12);
  });

  it('samples a SPLINE through its clamped endpoints', () => {
    const object = okObject(
      parse(
        dxf(
          entitiesSection(
            tags(
              [0, 'SPLINE'],
              [70, '0'],
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
              [10, '10'],
              [20, '10'],
            ),
          ),
        ),
      ),
    );
    const polyline = object.paths[0]?.polylines[0];
    if (polyline === undefined) throw new Error('spline polyline missing');
    // Clamped ends: (0,0) and (10,10) in DXF frame → normalized canvas frame
    // flips Y: start (0,10), end (10,0).
    expect(polyline.points[0]).toEqual({ x: 0, y: 10 });
    expect(polyline.points.at(-1)).toEqual({ x: 10, y: 0 });
  });
});

describe('parseDxf colors and layers', () => {
  it('resolves explicit ACI, BYLAYER, and true color', () => {
    const tables = [
      tags([0, 'SECTION'], [2, 'TABLES']),
      tags([0, 'LAYER'], [2, 'PARTS'], [62, '5']),
      tags([0, 'ENDSEC']),
    ].join('\n');
    const object = okObject(
      parse(
        dxf(
          tables,
          entitiesSection(
            [
              // explicit red
              tags([0, 'LINE'], [62, '1'], [10, '0'], [20, '0'], [11, '1'], [21, '0']),
              // BYLAYER → PARTS → blue
              tags([0, 'LINE'], [8, 'PARTS'], [10, '0'], [20, '1'], [11, '1'], [21, '1']),
              // 24-bit true color wins over everything
              tags(
                [0, 'LINE'],
                [62, '1'],
                [420, `${0x123456}`],
                [10, '0'],
                [20, '2'],
                [11, '1'],
                [21, '2'],
              ),
            ].join('\n'),
          ),
        ),
      ),
    );
    const colors = object.paths.map((path) => path.color).sort();
    expect(colors).toEqual(['#0000ff', '#123456', '#ff0000']);
  });
});

describe('parseDxf blocks', () => {
  it('expands INSERT references with translation and rotation', () => {
    const blocks = [
      tags([0, 'SECTION'], [2, 'BLOCKS']),
      tags([0, 'BLOCK'], [2, 'UNIT'], [10, '0'], [20, '0']),
      tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '10'], [21, '0']),
      tags([0, 'ENDBLK']),
      tags([0, 'ENDSEC']),
    ].join('\n');
    const object = okObject(
      parse(
        dxf(
          blocks,
          entitiesSection(
            [
              tags([0, 'INSERT'], [2, 'UNIT'], [10, '0'], [20, '0']),
              // rotated 90° CCW: the line runs up the Y axis from (100, 0)
              tags([0, 'INSERT'], [2, 'UNIT'], [10, '100'], [20, '0'], [50, '90']),
            ].join('\n'),
          ),
        ),
      ),
    );
    const polylines = object.paths.flatMap((path) => path.polylines);
    expect(polylines).toHaveLength(2);
    // Combined extents: x spans 0..100, y spans 0..10 (DXF frame) → same
    // magnitudes after flip.
    expect(object.bounds.maxX).toBeCloseTo(100, 6);
    expect(object.bounds.maxY).toBeCloseTo(10, 6);
  });

  it('notes unknown blocks and survives INSERT cycles via the depth cap', () => {
    const blocks = [
      tags([0, 'SECTION'], [2, 'BLOCKS']),
      tags([0, 'BLOCK'], [2, 'A'], [10, '0'], [20, '0']),
      tags([0, 'INSERT'], [2, 'A'], [10, '1'], [20, '0']),
      tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '1'], [21, '0']),
      tags([0, 'ENDBLK']),
      tags([0, 'ENDSEC']),
    ].join('\n');
    const result = parse(
      dxf(blocks, entitiesSection(tags([0, 'INSERT'], [2, 'A'], [10, '0'], [20, '0']))),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    // The self-inserting block bottoms out at the depth cap with a note,
    // and the direct LINEs still import.
    expect(result.object).not.toBeNull();
    expect(result.notes.some((note) => note.includes('deeper than'))).toBe(true);
  });
});

describe('parseDxf rejection and empty cases', () => {
  it('rejects binary DXF with the re-export hint', () => {
    const result = parse('AutoCAD Binary DXF\r\n rest');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('ASCII');
  });

  it('rejects a non-integer group code with its line number', () => {
    const result = parse('0\nSECTION\nnot-a-code\nVALUE\n');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('line 3');
  });

  it('rejects a truncated tag stream', () => {
    // No trailing newline: the group code on line 3 has no value line at all.
    const result = parse('0\nSECTION\n2');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('truncated');
  });

  it('returns object null plus a skip summary for unsupported-only files', () => {
    const result = parse(
      dxf(
        entitiesSection(
          [
            tags([0, 'TEXT'], [1, 'hello'], [10, '0'], [20, '0']),
            tags([0, 'TEXT'], [1, 'world'], [10, '0'], [20, '5']),
            tags([0, 'HATCH']),
          ].join('\n'),
        ),
      ),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.object).toBeNull();
    expect(result.skippedSummary).toBe('1 HATCH, 2 TEXT');
  });
});

describe('parseDxf value-level corruption (IMP-08)', () => {
  it('skips a LINE with a non-numeric coordinate instead of importing it at 0', () => {
    const result = parse(
      entitiesSection(
        [
          tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '10'], [21, '0']), // valid
          tags([0, 'LINE'], [10, 'not-a-number'], [20, '0'], [11, '5'], [21, '5']), // corrupt X
        ].join('\n'),
      ),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    // Only the valid line imports; the corrupt one is reported, not zeroed.
    expect(result.pathCount).toBe(1);
    expect(result.skippedSummary).toBe('1 LINE');
  });

  it('skips an entity whose coordinate magnitude exceeds the import cap', () => {
    const result = parse(
      entitiesSection(tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '2e9'], [21, '0'])),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.object).toBeNull();
    expect(result.skippedSummary).toBe('1 LINE');
  });

  it('still imports a large but in-range coordinate (regression: normal files unaffected)', () => {
    const result = parse(
      entitiesSection(tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '999999'], [21, '0'])),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.pathCount).toBe(1);
    expect(result.skippedSummary).toBeNull();
  });
});
