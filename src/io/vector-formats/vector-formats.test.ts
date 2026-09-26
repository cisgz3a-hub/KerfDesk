import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import { writeEpsDocument } from './eps-writer';
import { writeGeoJsonDocument } from './geojson-writer';
import { PT_PER_MM_TEXT, writePdfDocument } from './pdf-writer';
import { writeTracedDrawing } from './traced-drawing';
import { PT_PER_MM, type VectorPaintItem } from './vector-artwork';

// A small curved, holed artwork in scene millimetres (Y down): a rounded
// square with a square hole and a circular hole holding an island, plus an
// open red wave whose control points reach far beyond the curve itself.
const line = (x: number, y: number) => ({ kind: 'line' as const, to: { x, y } });
const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => ({
  kind: 'cubic' as const,
  control1: { x: x1, y: y1 },
  control2: { x: x2, y: y2 },
  to: { x, y },
});
const K = 2.76; // Rounded-corner handle length (5 mm radius).
const outer: CurveSubpath = {
  start: { x: 15, y: 5 },
  closed: true,
  segments: [
    line(35, 5),
    cubic(35 + K, 5, 40, 10 - K, 40, 10),
    line(40, 30),
    cubic(40, 30 + K, 35 + K, 35, 35, 35),
    line(15, 35),
    cubic(15 - K, 35, 10, 30 + K, 10, 30),
    line(10, 10),
    cubic(10, 10 - K, 15 - K, 5, 15, 5),
  ],
};
const squareHole: CurveSubpath = {
  start: { x: 14, y: 9 },
  closed: true,
  segments: [line(22, 9), line(22, 17), line(14, 17), line(14, 9)],
};
const circle = (cx: number, cy: number, r: number): CurveSubpath => ({
  start: { x: cx + r, y: cy },
  closed: true,
  segments: [
    { x: cx, y: cy + r },
    { x: cx - r, y: cy },
    { x: cx, y: cy - r },
    { x: cx + r, y: cy },
  ].map((to) => ({
    kind: 'elliptical-arc' as const,
    radiusX: r,
    radiusY: r,
    rotationDeg: 0,
    largeArc: false,
    sweep: true,
    to,
  })),
});
const island: CurveSubpath = {
  start: { x: 30, y: 25 },
  closed: true,
  segments: [line(32, 25), line(32, 27), line(30, 27), line(30, 25)],
};
const wave: CurveSubpath = {
  start: { x: 12, y: 40 },
  closed: false,
  segments: [cubic(20, 30, 30, 50, 38, 40)],
};
const SAMPLE: VectorPaintItem[] = [
  {
    color: '#1a2b3c',
    paint: 'fill',
    fillRule: 'evenodd',
    curves: [outer, squareHole, circle(31, 26, 4), island],
  },
  { color: '#ff0000', paint: 'stroke', fillRule: 'evenodd', curves: [wave] },
];

// Exact extent, computed independently: the wave's y extrema solve
// 6t^2 - 6t + 1 = 0, far inside its control points (30 and 50).
const waveY = (t: number): number =>
  40 * (1 - t) ** 3 + 90 * (1 - t) ** 2 * t + 150 * (1 - t) * t ** 2 + 40 * t ** 3;
const WAVE_MAX_Y = waveY(0.5 + Math.sqrt(3) / 6);
const EXACT = { minX: 10, minY: 5, maxX: 40, maxY: WAVE_MAX_Y };
const WIDTH_MM = EXACT.maxX - EXACT.minX;
const HEIGHT_MM = EXACT.maxY - EXACT.minY;
const GRID_MM = 0.001;
// The sample strokes a wave, so PDF/EPS pages grow by half the 0.1 mm stroke
// on every side (0.05 mm = 0.14173 pt, written rounded up as 0.1418 pt).
const MARGIN_PT = 0.1418;
const HALF_DIAGONAL_MM = (GRID_MM * Math.SQRT2) / 2;

const goldenPath = (name: string): string =>
  fileURLToPath(new URL('./__golden__/' + name, import.meta.url));

function expectGolden(name: string, text: string): void {
  if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(goldenPath(name), text);
  expect(text).toBe(readFileSync(goldenPath(name), 'utf8').replace(/\r\n/g, '\n'));
}

/** Page (mm, Y up, origin at the exact lower-left corner) → scene point. */
const toScene = (x: number, y: number): Vec2 => ({ x: x + EXACT.minX, y: EXACT.maxY - y });

describe('PDF writer', () => {
  const pdf = writePdfDocument(SAMPLE, { title: 'Sample (art)' });

  it('matches the golden file', () => {
    expectGolden('sample-artwork.pdf', pdf.text);
  });

  it('writes a structurally valid PDF 1.4 whose xref points at every object', () => {
    const text = pdf.text;
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    // 7-bit ASCII, so a character offset is a byte offset.
    expect([...text].every((char) => char.charCodeAt(0) < 0x7f)).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    const header = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
    const count = Number(header?.[1]);
    expect(count).toBe(6);
    const entriesStart = startxref + (header?.[0].length ?? 0);
    const entries = text.slice(entriesStart, entriesStart + count * 20);
    expect(entries.slice(0, 20)).toBe('0000000000 65535 f \n');
    for (let object = 1; object < count; object += 1) {
      const entry = entries.slice(object * 20, object * 20 + 20);
      expect(entry).toMatch(/^\d{10} 00000 n \n$/);
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset).startsWith(object + ' 0 obj\n')).toBe(true);
    }
    expect(text).toContain('trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>');
    // The stream's /Length counts exactly the bytes between the stream keywords.
    const stream = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(text);
    expect(Number(stream?.[1])).toBe(stream?.[2]?.length);
    expect(text).toContain('/Title (Sample \\(art\\))');
  });

  it('sizes the MediaBox from the exact curve bounds, not the control points', () => {
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.text);
    const width = Number(box?.[1]);
    const height = Number(box?.[2]);
    // The exact extent rounded outward (at most one grid step plus 0.0001 pt
    // larger), plus the stroke margin on both sides.
    for (const [written, exactMm] of [
      [width, WIDTH_MM],
      [height, HEIGHT_MM],
    ] as const) {
      expect(written).toBeGreaterThanOrEqual(exactMm * PT_PER_MM + 2 * MARGIN_PT);
      expect(written - exactMm * PT_PER_MM - 2 * MARGIN_PT).toBeLessThanOrEqual(
        GRID_MM * PT_PER_MM + 1e-4,
      );
    }
    // The control points would have made the page about 7 mm taller.
    expect(height).toBeLessThan((50 - 5) * PT_PER_MM);
  });

  it('paints fills with f*, closes contours with h and strokes the open wave', () => {
    const content = /stream\n([\s\S]*?)\nendstream/.exec(pdf.text)?.[1] ?? '';
    const lines = content.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'q',
      PT_PER_MM_TEXT + ' 0 0 ' + PT_PER_MM_TEXT + ' ' + MARGIN_PT + ' ' + MARGIN_PT + ' cm',
      '0.1 w 1 J 1 j',
    ]);
    expect(lines.filter((l) => l === 'h')).toHaveLength(4);
    expect(lines.filter((l) => l === 'f*')).toHaveLength(1);
    expect(lines.filter((l) => l === 'S')).toHaveLength(1);
    expect(lines).toContain('0.102 0.1686 0.2353 rg');
    expect(lines).toContain('1 0 0 RG');
    // Every operand parses back to its scene point within half a grid diagonal.
    const points = pageOperands(content);
    expect(points.length).toBeGreaterThan(20);
    expect(points).toContainEqual([4, 33.887]); // square hole corner (14, 9)
    const wave = lines.find((l) => l.endsWith(' c') && l.includes('-7.113'));
    expect(wave).toBe('10 12.887 20 -7.113 28 2.887 c'); // control points kept exact
  });

  it('round-trips through the PDF importer', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { pdfVectorPage } = await import('../pdf/pdf-vector-page');
    const task = pdfjs.getDocument({
      data: new TextEncoder().encode(pdf.text),
      stopAtErrors: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(1);
      const page = await document.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width).toBeCloseTo(pdf.widthPt, 6);
      const operators = await page.getOperatorList();
      const vector = pdfVectorPage(operators, pdfjs.OPS, viewport);
      expect(vector.reason).toBeNull();
      expect(vector.svg).toContain('<path');
      expect(vector.svg).toContain('#1a2b3c');
      expect(vector.svg).toContain('#ff0000');
    } finally {
      await task.destroy();
    }
  }, 30_000);
});

describe('EPS writer', () => {
  const eps = writeEpsDocument(SAMPLE, { title: 'Sample' });

  it('matches the golden file', () => {
    expectGolden('sample-artwork.eps', eps.text);
  });

  it('carries the EPSF 3.0 header and bounding boxes from the exact bounds', () => {
    const lines = eps.text.split('\n');
    expect(lines[0]).toBe('%!PS-Adobe-3.0 EPSF-3.0');
    const box = /^%%BoundingBox: 0 0 (\d+) (\d+)$/.exec(lines[1] ?? '');
    expect(Number(box?.[1])).toBe(Math.ceil(WIDTH_MM * PT_PER_MM + 2 * MARGIN_PT));
    expect(Number(box?.[2])).toBe(Math.ceil(HEIGHT_MM * PT_PER_MM + 2 * MARGIN_PT));
    const hires = /^%%HiResBoundingBox: 0 0 ([\d.]+) ([\d.]+)$/.exec(lines[2] ?? '');
    for (const [written, exactMm] of [
      [Number(hires?.[1]), WIDTH_MM],
      [Number(hires?.[2]), HEIGHT_MM],
    ] as const) {
      expect(written).toBeGreaterThanOrEqual(exactMm * PT_PER_MM + 2 * MARGIN_PT);
      expect(written - exactMm * PT_PER_MM - 2 * MARGIN_PT).toBeLessThanOrEqual(
        GRID_MM * PT_PER_MM + 1e-4,
      );
    }
    expect(lines).toContain(MARGIN_PT + ' ' + MARGIN_PT + ' translate');
    expect(lines).toContain('%%LanguageLevel: 2');
    expect(lines).toContain('%%EndComments');
    expect(lines.filter((l) => l === 'eofill')).toHaveLength(1);
    expect(lines.filter((l) => l === 'stroke')).toHaveLength(1);
    expect(lines.every((l) => l.length < 255)).toBe(true);
    expect(eps.text.trimEnd().endsWith('%%EOF')).toBe(true);
    // Balanced save/restore of the graphics state, one showpage.
    expect(lines.filter((l) => l === 'gsave')).toHaveLength(
      lines.filter((l) => l === 'grestore').length,
    );
  });

  it('writes the same page geometry as the PDF', () => {
    const pdfContent = /stream\n([\s\S]*?)\nendstream/.exec(writePdfDocument(SAMPLE).text)?.[1];
    const epsBody = eps.text.split('%%Page: 1 1\n')[1] ?? '';
    expect(pageOperands(epsBody)).toEqual(pageOperands(pdfContent ?? ''));
  });
});

describe('GeoJSON writer', () => {
  const geo = writeGeoJsonDocument(SAMPLE, { flattenToleranceMm: 0.01 });
  const parsed = JSON.parse(geo.text) as {
    type: string;
    bbox: number[];
    kerfdesk: Record<string, unknown>;
    features: {
      type: string;
      properties: Record<string, string>;
      geometry: { type: string; coordinates: unknown };
    }[];
  };

  it('matches the golden file', () => {
    expectGolden('sample-artwork.geojson', geo.text);
  });

  it('is an RFC 7946 FeatureCollection with stated units and axes', () => {
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.kerfdesk).toMatchObject({
      units: 'mm',
      flattenToleranceMm: 0.01,
      precisionMm: 0.001,
    });
    expect(parsed.features.map((f) => f.geometry.type)).toEqual(['MultiPolygon', 'LineString']);
    expect(parsed.features[0]?.properties).toEqual({
      color: '#1a2b3c',
      paint: 'fill',
      fillRule: 'evenodd',
    });
    expect(parsed.bbox[0]).toBe(0);
    expect(parsed.bbox[2]).toBeCloseTo(WIDTH_MM, 2);
  });

  it('writes closed, right-hand-rule rings with every hole inside its outer ring', () => {
    const polygons = parsed.features[0]?.geometry.coordinates as number[][][][];
    // The rounded square with two holes, and the island inside the circular hole.
    expect(polygons.map((polygon) => polygon.length)).toEqual([3, 1]);
    for (const polygon of polygons) {
      polygon.forEach((ring, index) => {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        const area = signedArea(ring);
        if (index === 0) expect(area).toBeGreaterThan(0);
        else expect(area).toBeLessThan(0);
      });
      const exterior = polygon[0] as number[][];
      for (const hole of polygon.slice(1)) {
        for (const point of hole) expect(insideRing(point, exterior)).toBe(true);
      }
    }
    // The island lies inside the circular hole, which is inside the outer ring.
    const islandRing = polygons[1]?.[0] as number[][];
    const circleHole = polygons[0]?.[2] as number[][]; // holes keep input order
    for (const point of islandRing) expect(insideRing(point, circleHole)).toBe(true);
  });

  it('keeps every flattened position within the tolerance of the true curve', () => {
    const circleHole = (parsed.features[0]?.geometry.coordinates as number[][][][])[0]?.[2];
    expect(circleHole?.length).toBeGreaterThan(20);
    for (const [x, y] of circleHole ?? []) {
      const scene = toScene(x as number, y as number);
      const radius = Math.hypot(scene.x - 31, scene.y - 26);
      expect(Math.abs(radius - 4)).toBeLessThanOrEqual(0.01 + HALF_DIAGONAL_MM);
    }
    const waveLine = parsed.features[1]?.geometry.coordinates as number[][];
    expect(waveLine[0]).toEqual([2, Number((WAVE_MAX_Y - 40).toFixed(3))]);
    // The wave rises to 2 * 2.887 mm on the page, not to its control point's 12.887.
    const topmost = Math.max(...waveLine.map((p) => p[1] as number));
    expect(topmost).toBeLessThanOrEqual(2 * WAVE_MAX_Y - 80 + HALF_DIAGONAL_MM);
    expect(topmost).toBeGreaterThan(2 * WAVE_MAX_Y - 80 - 0.01 - HALF_DIAGONAL_MM);
  });
});

describe('Multi-File Trace drawings', () => {
  const layers = [{ color: '#000000', curves: [squareHole] }];
  const page = { pageWidth: 50, pageHeight: 40, precisionMm: 0.01 };

  it('uses the traced page, not the artwork extent, with the lower-left origin', () => {
    const pdf = writeTracedDrawing('pdf', layers, { ...page, strokeOnly: false });
    expect(pdf).toContain('/MediaBox [0 0 ' + (50 * PT_PER_MM).toFixed(4) + ' ');
    // Scene (14, 9) on a 40 mm page is (14, 31) with y up.
    expect(pdf).toContain('\n14 31 m\n');
    expect(pdf).toContain('\nf*\n');
    const eps = writeTracedDrawing('eps', layers, { ...page, strokeOnly: true });
    expect(eps).toContain('%%BoundingBox: 0 0 142 114');
    expect(eps).toContain('\nstroke\n');
    const geo = JSON.parse(writeTracedDrawing('geojson', layers, { ...page, strokeOnly: false }));
    expect(geo.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [14, 31],
          [14, 23],
          [22, 23],
          [22, 31],
          [14, 31],
        ],
      ],
    });
  });
});

/** All numeric operand pairs of m/l/c path operators, in page millimetres. */
function pageOperands(text: string): number[][] {
  const out: number[][] = [];
  let numbers: number[] = [];
  for (const token of text.split(/\s+/)) {
    if (token === '') continue;
    const value = Number(token);
    if (Number.isFinite(value)) {
      numbers.push(value);
      continue;
    }
    if (token === 'm' || token === 'l' || token === 'c') {
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        out.push([numbers[i] as number, numbers[i + 1] as number]);
      }
    }
    numbers = [];
  }
  return out;
}

function signedArea(ring: ReadonlyArray<ReadonlyArray<number>>): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [ax, ay] = ring[i] as [number, number];
    const [bx, by] = ring[i + 1] as [number, number];
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

function insideRing(
  point: ReadonlyArray<number>,
  ring: ReadonlyArray<ReadonlyArray<number>>,
): boolean {
  const [px, py] = point as [number, number];
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i, i += 1) {
    const [ax, ay] = ring[i] as [number, number];
    const [bx, by] = ring[j] as [number, number];
    if (ay > py !== by > py && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) inside = !inside;
  }
  return inside;
}
