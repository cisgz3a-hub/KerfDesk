// Multi-File Trace page choice (ADR-451) through every writer: the image page
// stays byte-identical to the files written before the choice existed, and a
// fitted page is the exact curve extent plus the margin in every format.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import {
  DEFAULT_TRACE_OPTIONS,
  traceImagesToVectorFiles,
  type BatchTraceFormat,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import type { BatchTraceOutput } from '../../core/trace/batch-trace';
import { MIN_TRACED_PAGE_SIDE_MM, TRACED_HAIRLINE_MM } from '../../core/trace/traced-page-box';
import { tracedLayersToDxf } from '../dxf/export-dxf';
import { writeTracedDrawing } from './traced-drawing';
import {
  MIN_PAGE_SIDE_PT,
  PT_PER_MM,
  pointsOutward,
  VECTOR_STROKE_WIDTH_MM,
} from './vector-artwork';

// 200 x 100 px at 0.5 mm per pixel: a 100 x 50 mm image page.
const IMAGE: RawImageData = { width: 200, height: 100, data: new Uint8ClampedArray(200 * 100 * 4) };
const PHYSICAL = { widthMm: 100, heightMm: 50 };

// A filled dome: a cubic from (40,60) to (140,60) px whose controls sit at
// y = 20 px while the curve itself peaks at y = 30 px (t = 1/2), closed by a
// straight base. In mm: x 20..70, y 15..30; the control points reach y = 10.
const DOME: ColoredPath = {
  color: '#000000',
  polylines: [],
  curves: [
    {
      start: { x: 40, y: 60 },
      closed: true,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 40, y: 20 },
          control2: { x: 140, y: 20 },
          to: { x: 140, y: 60 },
        },
        { kind: 'line', to: { x: 40, y: 60 } },
      ],
    },
  ],
};

const FORMATS: ReadonlyArray<BatchTraceFormat> = ['svg', 'dxf', 'pdf', 'eps', 'geojson'];

async function traceFile(
  format: BatchTraceFormat,
  output: Omit<BatchTraceOutput, 'format'> = {},
  options: TraceOptions = DEFAULT_TRACE_OPTIONS,
  paths: ReadonlyArray<ColoredPath> = [DOME],
): Promise<string> {
  const result = await traceImagesToVectorFiles(
    [{ sourceName: 'dome.png', image: IMAGE, physicalSizeMm: PHYSICAL, options }],
    { trace: async () => paths, writeDxf: tracedLayersToDxf, writeDrawing: writeTracedDrawing },
    { ...output, format },
  );
  const file = result.files[0];
  if (file === undefined) throw new Error('no file written');
  return file.text;
}

const goldenPath = (name: string): string =>
  fileURLToPath(new URL('./__golden__/' + name, import.meta.url));

function expectGolden(name: string, text: string): void {
  if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(goldenPath(name), text);
  expect(text).toBe(readFileSync(goldenPath(name), 'utf8').replace(/\r\n/g, '\n'));
}

function numbersAfter(text: string, label: RegExp): number[] {
  const match = label.exec(text);
  if (match === null) throw new Error('missing ' + String(label));
  return (match[1] ?? '').trim().split(/\s+/).map(Number);
}

/** Every X (group 10) and Y (group 20) value of a DXF. */
function dxfPoints(text: string): { xs: number[]; ys: number[] } {
  const all = text.split(/\r?\n/).map((line) => line.trim());
  const lines = all.slice(all.indexOf('ENTITIES') + 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] === '10') xs.push(Number(lines[i + 1]));
    if (lines[i] === '20') ys.push(Number(lines[i + 1]));
  }
  return { xs, ys };
}

function geoJsonPositions(text: string): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length === 2 && value.every((v) => typeof v === 'number')) {
      out.push([value[0] as number, value[1] as number]);
      return;
    }
    value.forEach(walk);
  };
  const doc = JSON.parse(text) as { features: Array<{ geometry: { coordinates: unknown } }> };
  for (const feature of doc.features) walk(feature.geometry.coordinates);
  return out;
}

describe('traced page: image size (default)', () => {
  it.each(FORMATS)('%s matches the file written before the page choice existed', async (format) => {
    expectGolden('traced-image-page.' + format, await traceFile(format));
  });

  it.each(FORMATS)('%s ignores the margin on the image page', async (format) => {
    expect(await traceFile(format, { page: { fit: 'image', marginMm: 7 } })).toBe(
      await traceFile(format),
    );
  });
});

describe('traced page: fit to artwork', () => {
  const fitted = { page: { fit: 'artwork', marginMm: 5 } } as const;
  // Curve extent x 20..70, y 15..30 mm, plus 5 mm: a 60 x 25 mm page.
  // Control-point bounds would give y 10..30 and a 60 x 30 mm page.

  it('SVG: the viewBox and physical size are the curve extent plus the margin', async () => {
    const svg = await traceFile('svg', fitted);
    expect(svg).toContain(' viewBox="0 0 60 25" width="60mm" height="25mm"');
    // The dome's start point (20, 30) mm moves by the page corner (15, 10).
    expect(svg).toContain('d="M5 20c0-20 50-20 50 0z"');
  });

  it('PDF: the MediaBox is the fitted page in points', async () => {
    const pdf = await traceFile('pdf', fitted);
    const [x0, y0, w, h] = numbersAfter(pdf, /\/MediaBox \[([^\]]+)\]/);
    expect([x0, y0]).toEqual([0, 0]);
    expect(w).toBeCloseTo(60 * PT_PER_MM, 3);
    expect(h).toBeCloseTo(25 * PT_PER_MM, 3);
    expect(h).toBeGreaterThanOrEqual(25 * PT_PER_MM);
  });

  it('EPS: the bounding boxes are the fitted page in points', async () => {
    const eps = await traceFile('eps', fitted);
    expect(numbersAfter(eps, /%%BoundingBox:([^\n]+)/)).toEqual([0, 0, 171, 71]);
    const [, , w, h] = numbersAfter(eps, /%%HiResBoundingBox:([^\n]+)/);
    expect(w).toBeCloseTo(60 * PT_PER_MM, 3);
    expect(h).toBeCloseTo(25 * PT_PER_MM, 3);
  });

  it('DXF: the origin moves to the fitted page lower-left corner', async () => {
    const { xs, ys } = dxfPoints(await traceFile('dxf', fitted));
    expect(Math.min(...xs)).toBeCloseTo(5, 6);
    expect(Math.max(...xs)).toBeCloseTo(55, 6);
    expect(Math.min(...ys)).toBeCloseTo(5, 6);
    // The flattened dome top stays at or under the true peak, 5 mm below the page top.
    expect(Math.max(...ys)).toBeLessThanOrEqual(20 + 1e-9);
    expect(Math.max(...ys)).toBeGreaterThan(19.9);
  });

  it('GeoJSON: coordinates are measured from the fitted page corner', async () => {
    const positions = geoJsonPositions(await traceFile('geojson', fitted));
    expect(Math.min(...positions.map((p) => p[0]))).toBeCloseTo(5, 6);
    expect(Math.min(...positions.map((p) => p[1]))).toBeCloseTo(5, 6);
    expect(Math.max(...positions.map((p) => p[1]))).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('keeps millimetres per pixel exact: the fitted SVG stroke width is one source pixel', async () => {
    const svg = await traceFile('svg', fitted, {
      ...DEFAULT_TRACE_OPTIONS,
      traceMode: 'centerline',
    });
    expect(svg).toContain('stroke-width="0.5"');
    // Centerline adds half the widest hairline (one 0.5 mm pixel) around the extent.
    expect(svg).toContain(' viewBox="0 0 60.5 25.5" width="60.5mm" height="25.5mm"');
  });
});

describe('traced page: core constants mirror the io writers', () => {
  // Core cannot import io, so these tests are the only link between the copies.
  it('the stroke allowance hairline is the PDF/EPS stroke width', () => {
    expect(TRACED_HAIRLINE_MM).toBe(VECTOR_STROKE_WIDTH_MM);
  });

  it('the minimum fitted page side is the PDF/EPS minimum page side', () => {
    expect(MIN_TRACED_PAGE_SIDE_MM * PT_PER_MM).toBeCloseTo(MIN_PAGE_SIDE_PT, 12);
  });
});

describe('traced page: a fitted side under 3 pt is the same page in every format', () => {
  // A filled bar 100 px long and 0.4 px (0.2 mm) tall: x 20..70, y 30..30.2 mm.
  const BAR: ColoredPath = {
    color: '#000000',
    polylines: [],
    curves: [
      {
        start: { x: 40, y: 60 },
        closed: true,
        segments: [
          { kind: 'line', to: { x: 140, y: 60 } },
          { kind: 'line', to: { x: 140, y: 60.4 } },
          { kind: 'line', to: { x: 40, y: 60.4 } },
        ],
      },
    ],
  };
  const fitted = { page: { fit: 'artwork', marginMm: 0 } } as const;
  const bar = (format: BatchTraceFormat): Promise<string> =>
    traceFile(format, fitted, DEFAULT_TRACE_OPTIONS, [BAR]);
  // 3 pt = 1.0583 mm: 1059 steps on the default 0.001 mm grid, 429 steps
  // below the bar and 430 above, so the bar spans 0.43..0.63 mm (Y up).
  const heightMm = 1.059;
  const heightPt = pointsOutward(1059, { exponent: -3, step: 0.001 });

  it('SVG: the viewBox is grown to 3 pt on the grid', async () => {
    expect(await bar('svg')).toContain(' viewBox="0 0 50 1.059" width="50mm" height="1.059mm"');
  });

  it('PDF: the MediaBox is the SVG page, with no centring offset', async () => {
    const pdf = await bar('pdf');
    const [x0, y0, w, h] = numbersAfter(pdf, /\/MediaBox \[([^\]]+)\]/);
    expect([x0, y0]).toEqual([0, 0]);
    expect(w).toBeCloseTo(50 * PT_PER_MM, 3);
    expect(h).toBe(heightPt);
    expect(h).toBeGreaterThanOrEqual(MIN_PAGE_SIDE_PT);
    expect(h).toBeCloseTo(heightMm * PT_PER_MM, 3);
    expect(pdf).not.toMatch(/ [1-9][0-9.]* [0-9.]+ cm|[0-9.]+ [1-9][0-9.]* cm/);
  });

  it('EPS: the HiResBoundingBox is the SVG page, with no centring offset', async () => {
    const eps = await bar('eps');
    const [x0, y0, w, h] = numbersAfter(eps, /%%HiResBoundingBox:([^\n]+)/);
    expect([x0, y0]).toEqual([0, 0]);
    expect(w).toBeCloseTo(50 * PT_PER_MM, 3);
    expect(h).toBe(heightPt);
    expect(eps).not.toMatch(/[1-9][0-9.]* [0-9.]+ translate|[0-9.]+ [1-9][0-9.]* translate/);
  });

  it('DXF and GeoJSON: the bar sits where the grown page puts it', async () => {
    const { ys } = dxfPoints(await bar('dxf'));
    expect(Math.min(...ys)).toBeCloseTo(0.43, 9);
    expect(Math.max(...ys)).toBeCloseTo(0.63, 9);
    const positions = geoJsonPositions(await bar('geojson'));
    expect(Math.min(...positions.map((p) => p[1]))).toBeCloseTo(0.43, 9);
  });
});
