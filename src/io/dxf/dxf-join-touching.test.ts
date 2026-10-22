// DXF import joins touching LINE/ARC pieces into one outline (ADR-626
// Amendment 8; rolling audit 2026-10-21, 03-P2-9).

import { describe, expect, it } from 'vitest';
import { parseDxf, type ParseDxfResult } from './parse-dxf';

function tags(...pairs: ReadonlyArray<readonly [number, string | number]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function dxf(...entities: ReadonlyArray<string>): string {
  return [tags([0, 'SECTION'], [2, 'ENTITIES']), ...entities, tags([0, 'ENDSEC'], [0, 'EOF'])].join(
    '\n',
  );
}

function line(ax: number, ay: number, bx: number, by: number, color = 7): string {
  return tags([0, 'LINE'], [8, '0'], [62, color], [10, ax], [20, ay], [11, bx], [21, by]);
}

function arc(cx: number, cy: number, r: number, start: number, end: number): string {
  return tags([0, 'ARC'], [8, '0'], [10, cx], [20, cy], [40, r], [50, start], [51, end]);
}

function polylines(result: ParseDxfResult) {
  if (result.kind !== 'ok' || result.object === null) throw new Error('expected an import');
  return result.object.paths.flatMap((path) =>
    path.polylines.map((polyline, index) => ({ polyline, curve: path.curves?.[index] })),
  );
}

function parse(...entities: ReadonlyArray<string>): ParseDxfResult {
  return parseDxf({ dxfText: dxf(...entities), id: 'test', source: 'test.dxf' });
}

describe('DXF import joins touching pieces', () => {
  it('closes a square of four LINEs drawn in any direction', () => {
    const result = parse(
      line(0, 0, 40, 0),
      line(40, 40, 40, 0),
      line(40, 40, 0, 40),
      line(0, 0, 0, 40),
    );
    const [only, ...rest] = polylines(result);
    expect(rest).toEqual([]);
    expect(only?.polyline.closed).toBe(true);
    expect(only?.curve?.closed).toBe(true);
    expect(only?.curve?.segments).toHaveLength(4);
    if (result.kind === 'ok') expect(result.pathCount).toBe(1);
  });

  it('closes a slot of two LINEs and two ARCs, keeping the arcs', () => {
    // A 30 x 10 slot: straight sides, round ends. Arc ends come from their
    // angles, so they meet the lines only to within rounding.
    const [only, ...rest] = polylines(
      parse(line(0, 0, 30, 0), arc(30, 5, 5, 270, 90), line(30, 10, 0, 10), arc(0, 5, 5, 90, 270)),
    );
    expect(rest).toEqual([]);
    expect(only?.polyline.closed).toBe(true);
    // The importer stores an ARC as cubic curves; joining keeps them curves.
    const kinds = only?.curve?.segments.map((segment) => segment.kind) ?? [];
    expect(kinds.filter((kind) => kind === 'line').length).toBeGreaterThanOrEqual(2);
    expect(kinds.filter((kind) => kind === 'cubic').length).toBeGreaterThanOrEqual(2);
  });

  it('leaves a real gap open', () => {
    const pieces = polylines(
      parse(line(0, 0, 40, 0), line(40, 0, 40, 40), line(40, 40, 0, 40), line(0, 40, 0, 0.05)),
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.polyline.closed).toBe(false);
  });

  it('does not join three ends that meet at one point', () => {
    const pieces = polylines(parse(line(0, 0, 10, 0), line(10, 0, 20, 0), line(10, 0, 10, 10)));
    expect(pieces).toHaveLength(3);
    expect(pieces.every((piece) => !piece.polyline.closed)).toBe(true);
  });

  it('does not join pieces of different colours', () => {
    const pieces = polylines(
      parse(
        line(0, 0, 40, 0, 1),
        line(40, 0, 40, 40, 1),
        line(40, 40, 0, 40, 5),
        line(0, 40, 0, 0, 5),
      ),
    );
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => !piece.polyline.closed)).toBe(true);
  });

  it('leaves a closed entity as it is', () => {
    const pieces = polylines(
      parse(tags([0, 'CIRCLE'], [8, '0'], [10, 0], [20, 0], [40, 5]), line(5, 0, 10, 0)),
    );
    expect(pieces).toHaveLength(2);
    expect(pieces.map((piece) => piece.polyline.closed).sort()).toEqual([false, true]);
  });
});
