// Unit gate for the ADR-286 rule. The carve-level proof lives in
// compile-cnc-vcarve-text.test.ts (removal grid through the real compiler);
// this file pins the contract mergeTextObjectContours owes it, above all that
// OPEN contours are never merged — clipper closes everything it touches, so
// unioning a single-line font's strokes would invent a filled region.

import { describe, expect, it } from 'vitest';
import { normalizeClosedPolylinesEvenOddChecked } from '../geometry/polygon-difference';
import type { Polyline } from '../scene';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';
import { mergeTextObjectContours } from './vcarve-text-union';

function box(x: number, y: number, size: number): Polyline {
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

function reversed(polyline: Polyline): Polyline {
  return { ...polyline, points: [...polyline.points].reverse() };
}

function opened(polyline: Polyline): Polyline {
  return { ...polyline, closed: false };
}

function textContour(objectId: string, polyline: Polyline): CollectedCncContour {
  return { polyline, sourceKind: 'text', objectId };
}

function signedArea(polyline: Polyline): number {
  const pts = polyline.points;
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a === undefined || b === undefined) continue;
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

// Signed sum: clipper orients outer boundaries positive and holes negative, so
// this is the material actually enclosed — a counter subtracts.
function filledArea(polylines: ReadonlyArray<Polyline>): number {
  return Math.abs(polylines.reduce((sum, polyline) => sum + signedArea(polyline), 0));
}

const OVERLAPPING = [box(0, 0, 10), box(6, 0, 10)];

describe('mergeTextObjectContours', () => {
  it('merges overlapping glyphs of one text object into one filled region', () => {
    const merged = mergeTextObjectContours(OVERLAPPING.map((p) => textContour('t1', p)));

    expect(merged).toHaveLength(1);
    expect(filledArea(merged)).toBeCloseTo(160, 1);
  });

  it('differs from the even-odd reading precisely at the join', () => {
    const evenOdd = normalizeClosedPolylinesEvenOddChecked(OVERLAPPING);
    if (evenOdd.kind === 'error') throw new Error('even-odd normalize failed');
    const merged = mergeTextObjectContours(OVERLAPPING.map((p) => textContour('t1', p)));

    // Even-odd cancels the 4x10 lens and splits the artwork in two; non-zero
    // keeps it as one 16x10 region. This is the defect, stated as geometry.
    expect(evenOdd.value.length).toBeGreaterThan(1);
    expect(filledArea(evenOdd.value)).toBeCloseTo(160 - 40, 1);
    expect(merged).toHaveLength(1);
  });

  it('keeps glyph counters as holes', () => {
    const merged = mergeTextObjectContours([
      textContour('t1', box(0, 0, 10)),
      textContour('t1', reversed(box(3, 3, 4))),
    ]);

    expect(filledArea(merged)).toBeCloseTo(100 - 16, 1);
  });

  it('never merges open contours, so single-line strokes stay uncarvable', () => {
    const open = OVERLAPPING.map(opened);
    const merged = mergeTextObjectContours(open.map((p) => textContour('t1', p)));

    expect(merged).toEqual(open);
    expect(merged.every((polyline) => !polyline.closed)).toBe(true);
  });

  it('merges only the closed contours of a text object that mixes both', () => {
    const merged = mergeTextObjectContours([
      textContour('t1', box(0, 0, 10)),
      textContour('t1', opened(box(40, 0, 10))),
      textContour('t1', box(6, 0, 10)),
    ]);

    expect(merged.filter((polyline) => polyline.closed)).toHaveLength(1);
    expect(merged.filter((polyline) => !polyline.closed)).toHaveLength(1);
  });

  it('leaves cross-object overlap alone so the layer still pools even-odd', () => {
    const contours = [textContour('t1', box(0, 0, 10)), textContour('t2', box(6, 0, 10))];
    const merged = mergeTextObjectContours(contours);

    expect(merged).toEqual(contours.map((contour) => contour.polyline));
  });

  it('passes non-text contours through untouched, in source order', () => {
    const merged = mergeTextObjectContours(
      OVERLAPPING.map((polyline) => ({ polyline, sourceKind: 'imported-svg' as const })),
    );

    expect(merged).toEqual(OVERLAPPING);
  });

  it('preserves source order across mixed text and non-text objects', () => {
    const svg = box(40, 0, 5);
    const merged = mergeTextObjectContours([
      textContour('t1', box(0, 0, 10)),
      textContour('t1', box(6, 0, 10)),
      { polyline: svg, sourceKind: 'imported-svg' },
      textContour('t2', box(60, 0, 10)),
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[1]).toEqual(svg);
  });

  it('leaves legacy contours without provenance exactly as they were', () => {
    const merged = mergeTextObjectContours(OVERLAPPING.map((polyline) => ({ polyline })));

    expect(merged).toEqual(OVERLAPPING);
  });
});
