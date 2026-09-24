import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { flattenColoredPathCurves, type Polyline, type Vec2 } from '../../core/scene';
import { textToPolylines, type TextRenderResult } from '../../core/text';
import { weldTextRender } from '../../core/text/text-weld';

const FILES = [
  'GreatVibes-Regular.ttf',
  'Allura-Regular.ttf',
  'AlexBrush-Regular.ttf',
  'Parisienne-Regular.ttf',
  'PinyonScript-Regular.ttf',
  'Italianno-Regular.ttf',
  'Corinthia-Regular.ttf',
  'CinzelDecorative-Regular.ttf',
] as const;

const SAMPLE = 'Élodie & André · Zoë';

function contours(rendered: TextRenderResult): ReadonlyArray<Polyline> {
  return rendered.paths.flatMap((path) => {
    const flattened = flattenColoredPathCurves(path, { toleranceMm: 0.001 });
    if (flattened.kind !== 'ok') throw new Error('Could not flatten the font outlines.');
    return flattened.polylines;
  });
}

// Independent non-zero winding probe compares the ink region before/after
// welding, including empty counters. It does not call the polygon union code.
function windingAt(point: Vec2, polylines: ReadonlyArray<Polyline>): number {
  let winding = 0;
  for (const polyline of polylines) {
    for (let index = 0; index < polyline.points.length; index += 1) {
      const from = polyline.points[index];
      const to = polyline.points[(index + 1) % polyline.points.length];
      if (from === undefined || to === undefined) continue;
      const cross = (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y);
      if (from.y <= point.y && to.y > point.y && cross > 0) winding += 1;
      if (from.y > point.y && to.y <= point.y && cross < 0) winding -= 1;
    }
  }
  return winding;
}

// All 56 samples in a row have the same Y. Ignore edges that cannot cross that
// row once, while preserving the brute-force probe's exact cross-product and
// half-open endpoint rules (including points lying directly on an edge).
function windingOnRow(y: number, polylines: ReadonlyArray<Polyline>): (x: number) => number {
  const edges: Array<readonly [Vec2, Vec2, 1 | -1]> = [];
  for (const polyline of polylines) {
    for (let index = 0; index < polyline.points.length; index += 1) {
      const from = polyline.points[index];
      const to = polyline.points[(index + 1) % polyline.points.length];
      if (from === undefined || to === undefined) continue;
      if (from.y <= y && to.y > y) edges.push([from, to, 1]);
      if (from.y > y && to.y <= y) edges.push([from, to, -1]);
    }
  }
  return (x) => {
    let winding = 0;
    for (const [from, to, direction] of edges) {
      const cross = (to.x - from.x) * (y - from.y) - (x - from.x) * (to.y - from.y);
      if (direction === 1 ? cross > 0 : cross < 0) winding += direction;
    }
    return winding;
  };
}

describe('bundled calligraphy collection', () => {
  it('matches brute-force winding at vertices, edges, counters, and overlaps', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const inset = square.map(({ x, y }) => ({ x: 1 + x / 2, y: 1 + y / 2 }));
    const fixtures: ReadonlyArray<ReadonlyArray<Polyline>> = [
      [],
      [{ points: [], closed: true }],
      [{ points: [{ x: 0, y: 0 }], closed: true }],
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
          ],
          closed: false,
        },
      ],
      [{ points: square, closed: true }],
      [{ points: [...square].reverse(), closed: true }],
      [{ points: [...square, square[0]!], closed: true }],
      [
        { points: square, closed: true },
        { points: inset, closed: true },
      ],
      [
        { points: square, closed: true },
        { points: [...inset].reverse(), closed: true },
      ],
      [
        { points: square, closed: true },
        { points: square.map(({ x, y }) => ({ x: x + 2, y })), closed: true },
      ],
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 },
          ],
          closed: false,
        },
      ],
      [{ points: [square[0]!, square[2]!, square[3]!, square[1]!], closed: true }],
    ];
    const coordinates = [
      -1,
      -Number.EPSILON,
      0,
      Number.MIN_VALUE,
      0.5,
      1 - Number.EPSILON,
      1,
      1 + Number.EPSILON,
      2,
      3,
      4 - Number.EPSILON * 2,
      4,
      4 + Number.EPSILON * 4,
      5,
      6,
    ];
    for (const [fixture, polylines] of fixtures.entries()) {
      for (const y of coordinates) {
        const atX = windingOnRow(y, polylines);
        for (const x of coordinates) {
          strictEqual(atX(x), windingAt({ x, y }, polylines), `fixture ${fixture} at ${x},${y}`);
        }
      }
    }
  });

  it.each(FILES)('%s renders accented names and welds their actual outlines', async (file) => {
    const bytes = readFileSync(`src/ui/text/fonts/${file}`);
    const fontBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const font = parse(fontBuffer);
    for (const character of new Set(SAMPLE.replaceAll(' ', ''))) {
      expect(font.charToGlyphIndex(character), `${file} is missing ${character}`).toBeGreaterThan(
        0,
      );
    }
    const source = await textToPolylines({
      content: SAMPLE,
      fontBuffer,
      sizeMm: 24,
      alignment: 'left',
      lineHeight: 1.4,
      letterSpacing: 0,
      color: '#111111',
    });
    const result = weldTextRender(source);
    if (result.kind !== 'ok') throw new Error(result.error.message);
    const before = contours(source);
    const after = contours(result.value);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((line) => line.closed)).toBe(true);
    expect(
      after
        .flatMap((line) => line.points)
        .every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ).toBe(true);
    expect(source.bounds.maxX - source.bounds.minX).toBeGreaterThan(10);
    expect(source.bounds.maxY - source.bounds.minY).toBeGreaterThan(5);
    let inkSamples = 0;
    for (let y = 0; y < 40; y += 1) {
      const sampleY =
        source.bounds.minY + ((y + 0.47) / 40) * (source.bounds.maxY - source.bounds.minY);
      const beforeAtX = windingOnRow(sampleY, before);
      const afterAtX = windingOnRow(sampleY, after);
      for (let x = 0; x < 56; x += 1) {
        const point = {
          x: source.bounds.minX + ((x + 0.31) / 56) * (source.bounds.maxX - source.bounds.minX),
          y: sampleY,
        };
        const rawWinding = beforeAtX(point.x);
        const weldedWinding = afterAtX(point.x);
        strictEqual(weldedWinding !== 0, rawWinding !== 0, `${file} preserves ink at ${x},${y}`);
        ok(Math.abs(weldedWinding) <= 1, `${file} has no overlapping winding at ${x},${y}`);
        if (rawWinding !== 0) inkSamples += 1;
      }
    }
    expect(inkSamples).toBeGreaterThan(20);
  });
});
