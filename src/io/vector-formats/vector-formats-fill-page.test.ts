// ADR-455 review fixes: GeoJSON follows each item's fill rule (the region the
// PDF and EPS files paint), crossing contours are reported instead of written
// as an invalid MultiPolygon, stroked ink stays on the PDF/EPS page, and
// oversized PDF pages use /UserUnit.

import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import { writeEpsDocument } from './eps-writer';
import { fillRegionPolygons } from './fill-region-rings';
import { writeGeoJsonDocument } from './geojson-writer';
import { writePdfDocument } from './pdf-writer';
import {
  PT_PER_MM,
  VECTOR_STROKE_WIDTH_MM,
  type VectorFillRule,
  type VectorPaintItem,
} from './vector-artwork';

/** Closed polygon contour in scene mm (Y down), in the given point order. */
const contour = (points: ReadonlyArray<Vec2>): CurveSubpath => ({
  start: points[0] as Vec2,
  closed: true,
  segments: [...points.slice(1), points[0] as Vec2].map((to) => ({ kind: 'line' as const, to })),
});
/** Square at (x, y) of side s; `reverse` flips its winding. */
const square = (x: number, y: number, s: number, reverse = false): CurveSubpath => {
  const points = [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  return contour(reverse ? points.reverse() : points);
};
const fill = (fillRule: VectorFillRule, curves: CurveSubpath[]): VectorPaintItem => ({
  color: '#000000',
  paint: 'fill',
  fillRule,
  curves,
});

type Feature = {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};
const geo = (items: VectorPaintItem[]) => {
  const document = writeGeoJsonDocument(items);
  return { document, features: (JSON.parse(document.text) as { features: Feature[] }).features };
};
const polygonsOf = (feature: Feature): number[][][][] =>
  feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as number[][][]]
    : (feature.geometry.coordinates as number[][][][]);

/** Winding number of p about a closed polyline (vertices, first not repeated). */
function winding(p: Vec2, ring: ReadonlyArray<Vec2>): number {
  let wn = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % ring.length] as Vec2;
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) wn += 1;
    } else if (b.y <= p.y && cross < 0) wn -= 1;
  }
  return wn;
}
const vertices = (curve: CurveSubpath): Vec2[] => [
  curve.start,
  ...curve.segments.slice(0, -1).map((s) => s.to),
];

/** Whether the scene point is painted by the item under its own fill rule (what PDF/EPS draw). */
function paintedBy(item: VectorPaintItem, p: Vec2): boolean {
  const windings = item.curves.map((curve) => winding(p, vertices(curve)));
  if (item.fillRule === 'nonzero') return windings.reduce((a, b) => a + b, 0) !== 0;
  return windings.reduce((a, w) => a + (w !== 0 ? 1 : 0), 0) % 2 === 1;
}

/** Whether a page point lies in the GeoJSON features' polygons (outer minus holes). */
function inGeoJson(features: Feature[], p: Vec2): boolean {
  let hits = 0;
  for (const feature of features) {
    for (const polygon of polygonsOf(feature)) {
      const rings = polygon.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }) as Vec2));
      const [outer, ...holes] = rings;
      if (outer === undefined || winding(p, outer) === 0) continue;
      if (holes.some((hole) => winding(p, hole) !== 0)) continue;
      hits += 1;
    }
  }
  return hits > 0;
}

/** Samples a grid of off-lattice points; page = scene with y mirrored about the extent. */
function expectSameRegion(item: VectorPaintItem, extent: { maxX: number; maxY: number }): void {
  const { features } = geo([item]);
  let painted = 0;
  for (let x = 0.25; x < extent.maxX; x += 0.5) {
    for (let y = 0.25; y < extent.maxY; y += 0.5) {
      const scene = { x, y };
      const page = { x, y: extent.maxY - y };
      const expected = paintedBy(item, scene);
      if (expected) painted += 1;
      expect(inGeoJson(features, page), `(${x}, ${y})`).toBe(expected);
    }
  }
  expect(painted).toBeGreaterThan(0);
}

describe('GeoJSON follows the fill rule the PDF and EPS paint', () => {
  it('fills a same-winding nested pair solid under nonzero, as PDF f does', () => {
    const item = fill('nonzero', [square(0, 0, 10), square(3, 3, 4)]);
    const { features } = geo([item]);
    expect(features).toHaveLength(1);
    expect(features[0]?.geometry.type).toBe('Polygon');
    expect(polygonsOf(features[0] as Feature)[0]).toHaveLength(1); // no hole
    expect(features[0]?.properties).toEqual({
      color: '#000000',
      paint: 'fill',
      fillRule: 'nonzero',
    });
    expect(writePdfDocument([item]).text).toContain('\nf\n');
    expect(writeEpsDocument([item]).text).toContain('\nfill\n');
    expectSameRegion(item, { maxX: 10, maxY: 10 });
  });

  it('cuts an opposite-winding nested contour as a hole under nonzero', () => {
    const item = fill('nonzero', [square(0, 0, 10), square(3, 3, 4, true)]);
    const polygons = polygonsOf(geo([item]).features[0] as Feature);
    expect(polygons.map((p) => p.length)).toEqual([2]);
    expectSameRegion(item, { maxX: 10, maxY: 10 });
  });

  it('cuts a nested contour as a hole under even-odd whatever its winding', () => {
    const item = fill('evenodd', [square(0, 0, 10), square(3, 3, 4)]);
    expect(polygonsOf(geo([item]).features[0] as Feature).map((p) => p.length)).toEqual([2]);
    expectSameRegion(item, { maxX: 10, maxY: 10 });
  });

  it('sums windings through several nesting levels under nonzero', () => {
    // +1, +1, -1: winding 1, 2, 1 inside, so everything inside the outer is ink.
    const solid = fill('nonzero', [square(0, 0, 12), square(2, 2, 8), square(4, 4, 4, true)]);
    expect(polygonsOf(geo([solid]).features[0] as Feature).map((p) => p.length)).toEqual([1]);
    expectSameRegion(solid, { maxX: 12, maxY: 12 });
    // +1, -1, +1: a hole with an island in it.
    const island = fill('nonzero', [square(0, 0, 12), square(2, 2, 8, true), square(4, 4, 4)]);
    const polygons = polygonsOf(geo([island]).features[0] as Feature);
    expect(polygons.map((p) => p.length)).toEqual([2, 1]);
    expectSameRegion(island, { maxX: 12, maxY: 12 });
  });

  it('writes crossing contours as separate unmerged features and counts them', () => {
    const item = fill('evenodd', [square(0, 0, 10), square(5, 5, 10)]);
    const { document, features } = geo([item]);
    expect(document.unmergedItemCount).toBe(1);
    expect(features.map((f) => f.geometry.type)).toEqual(['Polygon', 'Polygon']);
    for (const feature of features) expect(feature.properties['unmerged']).toBe(true);
  });

  it('keeps disjoint and corner-touching contours as one MultiPolygon', () => {
    const item = fill('evenodd', [square(0, 0, 5), square(5, 5, 5), square(20, 0, 2)]);
    const { document, features } = geo([item]);
    expect(document.unmergedItemCount).toBe(0);
    expect(features.map((f) => f.geometry.type)).toEqual(['MultiPolygon']);
    expect(features[0]?.properties['unmerged']).toBeUndefined();
  });
});

describe('fill-region rings', () => {
  const ring = (points: Array<[number, number]>) => points.map(([x, y]) => ({ x, y }));

  it('reports a self-crossing ring', () => {
    const figureEight = ring([
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ]);
    expect(fillRegionPolygons([figureEight], 'nonzero').crossing).toBe(true);
  });

  it('reports duplicate rings, whose containment cannot be decided', () => {
    const a = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(fillRegionPolygons([a, [...a]], 'evenodd').crossing).toBe(true);
  });

  it('decides containment past vertices shared with the container', () => {
    // The inner triangle touches the outer square's edge at two vertices.
    const outer = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const inner = ring([
      [0, 5],
      [5, 0],
      [5, 5],
    ]);
    const region = fillRegionPolygons([outer, inner], 'evenodd');
    expect(region.crossing).toBe(false);
    expect(region.polygons).toEqual([{ outer: 0, holes: [1] }]);
  });
});

/** Operands of the page cm (PDF) as [scale, tx, ty], and every m/l/c point in mm. */
function pdfPage(text: string) {
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
  const cm = /\n([\d.]+) 0 0 [\d.]+ ([\d.]+) ([\d.]+) cm\n/.exec(text);
  const points: Vec2[] = [];
  for (const line of text.split('\n')) {
    const match = /^([-\d. ]+) [mlc]$/.exec(line);
    if (match === null) continue;
    const numbers = (match[1] as string).split(' ').map(Number);
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      points.push({ x: numbers[i] as number, y: numbers[i + 1] as number });
    }
  }
  return {
    width: Number(box?.[1]),
    height: Number(box?.[2]),
    scale: Number(cm?.[1]),
    tx: Number(cm?.[2]),
    ty: Number(cm?.[3]),
    points,
  };
}

const stroke = (curves: CurveSubpath[]): VectorPaintItem => ({
  color: '#000000',
  paint: 'stroke',
  fillRule: 'evenodd',
  curves,
});
const HALF_STROKE_PT = (VECTOR_STROKE_WIDTH_MM / 2) * PT_PER_MM;

function expectInkOnPage(text: string): void {
  const page = pdfPage(text);
  expect(page.points.length).toBeGreaterThan(1);
  for (const p of page.points) {
    const x = page.tx + p.x * page.scale;
    const y = page.ty + p.y * page.scale;
    expect(x - HALF_STROKE_PT).toBeGreaterThanOrEqual(0);
    expect(y - HALF_STROKE_PT).toBeGreaterThanOrEqual(0);
    expect(x + HALF_STROKE_PT).toBeLessThanOrEqual(page.width + 1e-9);
    expect(y + HALF_STROKE_PT).toBeLessThanOrEqual(page.height + 1e-9);
  }
}

describe('PDF and EPS pages hold the painted ink', () => {
  it('keeps the whole hairline of a stroked rectangle inside MediaBox and BoundingBox', () => {
    const items = [stroke([square(0, 0, 10)])];
    const pdf = writePdfDocument(items);
    expectInkOnPage(pdf.text);
    expect(pdf.widthPt).toBeGreaterThanOrEqual(10 * PT_PER_MM + 2 * HALF_STROKE_PT);
    const eps = writeEpsDocument(items);
    expect(eps.widthPt).toBe(pdf.widthPt);
    expect(eps.text).toContain('\n0.1418 0.1418 translate\n');
    expect(eps.text).toContain('%%BoundingBox: 0 0 29 29\n');
  });

  it('gives a lone horizontal line a page of at least 3 pt with its stroke inside', () => {
    const line: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [{ kind: 'line', to: { x: 20, y: 0 } }],
    };
    const pdf = writePdfDocument([stroke([line])]);
    expect(pdf.heightPt).toBe(3);
    expectInkOnPage(pdf.text);
    const page = pdfPage(pdf.text);
    // Centred on the 3 pt page.
    expect(page.ty + (page.points[0]?.y ?? NaN) * page.scale).toBeCloseTo(1.5, 2);
    const eps = writeEpsDocument([stroke([line])]);
    expect(eps.text).toContain('%%HiResBoundingBox: 0 0 56.9766 3\n');
    expect(eps.text).toContain('%%BoundingBox: 0 0 57 3\n');
  });

  it('adds no margin for fill-only artwork or a caller page', () => {
    const filled = writePdfDocument([fill('evenodd', [square(0, 0, 10)])]);
    expect(pdfPage(filled.text)).toMatchObject({ tx: 0, ty: 0 });
    expect(filled.widthPt).toBe(28.3465);
    const traced = writePdfDocument([stroke([square(0, 0, 10)])], {
      page: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    });
    expect(pdfPage(traced.text)).toMatchObject({ tx: 0, ty: 0, width: 28.3465 });
  });
});

describe('Oversized PDF pages', () => {
  it('stays PDF 1.4 up to 14400 units per side', () => {
    const pdf = writePdfDocument([fill('evenodd', [square(0, 0, 5000)])]);
    expect(pdf.userUnit).toBe(1);
    expect(pdf.text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.text).not.toContain('/UserUnit');
  });

  it('writes PDF 1.6 with /UserUnit so every MediaBox side stays within 14400', () => {
    const pdf = writePdfDocument([fill('evenodd', [square(0, 0, 6000)])]);
    expect(pdf.userUnit).toBe(2);
    expect(pdf.text.startsWith('%PDF-1.6\n')).toBe(true);
    expect(pdf.text).toContain('/UserUnit 2 ');
    const page = pdfPage(pdf.text);
    expect(page.width).toBeLessThanOrEqual(14400);
    // Physical size is unchanged: MediaBox units times UserUnit.
    expect(page.width * 2).toBeGreaterThanOrEqual(6000 * PT_PER_MM);
    expect(page.width * 2 - 6000 * PT_PER_MM).toBeLessThan(0.01);
    expect(page.scale * 2).toBeCloseTo(PT_PER_MM, 12);
    // The cross-reference table still points at every object.
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf.text)?.[1]);
    expect(pdf.text.slice(startxref, startxref + 5)).toBe('xref\n');
    const entries = pdf.text.slice(startxref).split('\n').slice(2, 8);
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(pdf.text.slice(offset).startsWith(index + 1 + ' 0 obj\n')).toBe(true);
    });
  });
});
