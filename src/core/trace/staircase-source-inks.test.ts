import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { jpegRoundTrip } from '../../__fixtures__/perceptual/jpeg-roundtrip';
import type { CurveSubpath, Vec2 } from '../scene';
import { textToPolylines } from '../text/text-to-polylines';
import { prepareContourTraceInput } from './contour-input';
import { cleanStaircaseSource } from './staircase-source';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import type { TraceReport, TraceStepRunner } from './trace-steps';
import { traceImageToColoredPaths } from './trace-to-paths';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const SMOOTH = TRACE_PRESETS['Smooth'] as TraceOptions;

type Rgb = readonly [number, number, number];
type InkAt = (x: number, y: number) => boolean;

const BLACK: Rgb = [0, 0, 0];
const INKS: ReadonlyArray<readonly [string, Rgb]> = [
  ['grey 40', [40, 40, 40]],
  ['grey 80', [80, 80, 80]],
  ['grey 100', [100, 100, 100]],
  ['red', [255, 0, 0]],
  ['teal', [0, 128, 128]],
];

function painted(width: number, height: number, inkAt: InkAt, ink: Rgb): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inkAt(x, y)) data.set(ink, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const bars =
  (stroke: number, height: number): InkAt =>
  (x, y) =>
    y >= 8 && y < height - 8 && x % 12 >= 4 && x % 12 < 4 + stroke;
const grid =
  (stroke: number): InkAt =>
  (x, y) =>
    (x % 16 >= 3 && x % 16 < 3 + stroke) || (y % 16 >= 3 && y % 16 < 3 + stroke);

function discOf(canvas: number): { readonly cx: number; readonly cy: number; readonly r: number } {
  return { cx: canvas / 2 + 0.31, cy: canvas / 2 + 0.17, r: canvas * 0.33 };
}

function discInk(canvas: number): InkAt {
  const { cx, cy, r } = discOf(canvas);
  return (x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r;
}

function softDisc(canvas: number, ink: number): RawImageData {
  const { cx, cy, r } = discOf(canvas);
  const data = new Uint8ClampedArray(canvas * canvas * 4).fill(255);
  for (let y = 0; y < canvas; y += 1) {
    for (let x = 0; x < canvas; x += 1) {
      let covered = 0;
      for (let j = 0; j < 4; j += 1) {
        for (let i = 0; i < 4; i += 1) {
          if (Math.hypot(x + (i + 0.5) / 4 - cx, y + (j + 0.5) / 4 - cy) < r) covered += 1;
        }
      }
      const level = Math.round(255 + ((ink - 255) * covered) / 16);
      data.set([level, level, level], (y * canvas + x) * 4);
    }
  }
  return { width: canvas, height: canvas, data };
}

function jpeg(image: RawImageData, quality: number): RawImageData {
  const { width, height } = image;
  const luma = Array.from({ length: width * height }, (_, p) => image.data[p * 4] as number);
  const data = new Uint8ClampedArray(width * height * 4);
  jpegRoundTrip(luma, width, height, quality).forEach((value, p) => {
    data.set([value, value, value, 255], p * 4);
  });
  return { width, height, data };
}

async function traced(image: RawImageData, options: TraceOptions): Promise<CurveSubpath[]> {
  const paths = await traceImageToColoredPaths(image, options);
  return paths.flatMap((path) => path.curves ?? []);
}

function outline(curve: CurveSubpath): Vec2[] {
  const points: Vec2[] = [];
  let at = curve.start;
  for (const segment of curve.segments) {
    for (let k = 0; k < 16; k += 1) {
      const t = k / 16;
      const u = 1 - t;
      if (segment.kind !== 'cubic') {
        points.push({ x: at.x + t * (segment.to.x - at.x), y: at.y + t * (segment.to.y - at.y) });
        continue;
      }
      const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      points.push({
        x: a * at.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
        y: a * at.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
      });
    }
    at = segment.to;
  }
  return points;
}

function enclosedArea(curve: CurveSubpath): number {
  const points = outline(curve);
  let twice = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as Vec2;
    twice += p.x * q.y - q.x * p.y;
  });
  return Math.abs(twice) / 2;
}

function radialError(curves: ReadonlyArray<CurveSubpath>, canvas: number): number {
  const { cx, cy, r } = discOf(canvas);
  const points = curves.flatMap(outline);
  const total = points.reduce((sum, p) => sum + Math.abs(Math.hypot(p.x - cx, p.y - cy) - r), 0);
  return total / points.length;
}

async function oneBitWord(
  content: string,
  px: number,
): Promise<{ readonly width: number; readonly height: number; readonly inkAt: InkAt }> {
  const bytes = readFileSync(resolve('src/ui/text/fonts', 'Roboto-Regular.ttf'));
  const fontBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const rendered = await textToPolylines({
    fontBuffer: fontBuffer as ArrayBuffer,
    content,
    sizeMm: px,
    alignment: 'left',
    lineHeight: 1,
    color: '#000000',
  });
  const { minX, minY, maxX, maxY } = rendered.bounds;
  const pad = 8;
  const rings = rendered.paths
    .flatMap((path) => path.polylines)
    .map((line) =>
      line.points.map((p) => ({ x: p.x - minX + pad + 0.31, y: p.y - minY + pad + 0.17 })),
    );
  return {
    width: Math.ceil(maxX - minX + 2 * pad),
    height: Math.ceil(maxY - minY + 2 * pad),
    inkAt: (x, y) => {
      const [cx, cy] = [x + 0.5, y + 0.5];
      let inside = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
          const p = ring[i] as Vec2;
          const q = ring[j] as Vec2;
          if (p.y > cy !== q.y > cy && cx < p.x + ((cy - p.y) * (q.x - p.x)) / (q.y - p.y)) {
            inside = !inside;
          }
        }
      }
      return inside;
    },
  };
}

describe('hard art traces as its black twin in any ink (ADR-530 Amendment 13)', () => {
  // Rolling audit v9 R2-P1-1: Line Art's 2x route read grey ink back as paper a
  // quarter pixel from an edge (2 px bars kept 49%), and grew coloured strokes
  // by a pixel (red 3 px bars +35%).
  describe.each(INKS)('%s', (_name, ink) => {
    it.each([
      ['2 px bars, 90 x 60', 90, 60, bars(2, 60)],
      ['3 px bars, 90 x 60', 90, 60, bars(3, 60)],
      ['2 px bars, 300 x 100', 300, 100, bars(2, 100)],
      ['3 px bars, 300 x 100', 300, 100, bars(3, 100)],
      ['2 px grid, 300 x 200', 300, 200, grid(2)],
      ['3 px grid, 300 x 200', 300, 200, grid(3)],
    ] as const)('keeps %s', async (_scene, width, height, inkAt) => {
      expect(await traced(painted(width, height, inkAt, ink), LINE_ART)).toEqual(
        await traced(painted(width, height, inkAt, BLACK), LINE_ART),
      );
    });

    // R2-P2-1: a grey 40 disc drew 4 segments at 99 px and 33 at 100 px, and a
    // teal one 149 at 400 px, where black drew 24.
    it.each([64, 99, 100, 200, 400, 1024])(
      'draws a disc on a %i px canvas',
      async (canvas) => {
        for (const options of [LINE_ART, SMOOTH]) {
          expect(await traced(painted(canvas, canvas, discInk(canvas), ink), options)).toEqual(
            await traced(painted(canvas, canvas, discInk(canvas), BLACK), options),
          );
        }
      },
      30_000,
    );
  });

  it('keeps the width of black bars themselves', async () => {
    for (const [stroke, width, height] of [
      [2, 90, 60],
      [3, 90, 60],
      [2, 300, 100],
      [3, 300, 100],
    ] as const) {
      const art = painted(width, height, bars(stroke, height), BLACK);
      const inkArea = art.data.filter((value, i) => i % 4 === 0 && value === 0).length;
      const curves = await traced(art, LINE_ART);
      const area = curves.reduce((sum, curve) => sum + enclosedArea(curve), 0);
      expect(Math.abs(area - inkArea) / inkArea).toBeLessThan(0.03);
    }
  });

  // A manual band has no single cut to clean the art at, so it stays on the
  // source grid's own route, where the enlarged mask must not move an edge.
  it('keeps thin strokes through a manual band', async () => {
    const band: TraceOptions = { ...LINE_ART, cutoffLuma: 10 };
    const [stroke, height] = [2, 60];
    const curves = await traced(painted(90, height, bars(stroke, height), [100, 100, 100]), band);
    expect(curves).toHaveLength(8);
    const inkArea = 8 * stroke * (height - 16);
    const area = curves.reduce((sum, curve) => sum + enclosedArea(curve), 0);
    expect(Math.abs(area - inkArea) / inkArea).toBeLessThan(0.03);
  });

  it.each([20, 24, 32])('keeps the parts and holes of 1-bit text at %i px', async (px) => {
    // R2-P1-1: 1-bit Arial at 20 px in luma 100 tore into 34 parts with none of
    // its 10 holes.
    const word = await oneBitWord('Sample gear 8ab', px);
    const black = await traced(painted(word.width, word.height, word.inkAt, BLACK), LINE_ART);
    for (const [name, ink] of INKS) {
      const curves = await traced(painted(word.width, word.height, word.inkAt, ink), LINE_ART);
      expect(curves, name).toEqual(black);
    }
  });

  it.each([75, 60])(
    'draws a quality %i JPEG of grey ink like black',
    async (quality) => {
      for (const canvas of [64, 99, 100, 200, 400]) {
        for (const level of [0, 40, 80, 100]) {
          const art = painted(canvas, canvas, discInk(canvas), [level, level, level]);
          const curves = await traced(jpeg(art, quality), LINE_ART);
          const label = `luma ${level} on ${canvas} px`;
          expect(curves, label).toHaveLength(1);
          expect((curves[0] as CurveSubpath).segments.length, label).toBeLessThanOrEqual(30);
          expect(radialError(curves, canvas), label).toBeLessThan(0.4);
        }
      }
    },
    60_000,
  );

  it('reads two inks on one sheet against their own tones', async () => {
    for (const canvas of [96, 150, 400]) {
      const art = painted(canvas, canvas, discInk(canvas), BLACK);
      for (let p = 0; p < canvas * canvas; p += 1) {
        if (art.data[p * 4] === 0 && p % canvas >= canvas / 2) art.data.fill(90, p * 4, p * 4 + 3);
      }
      for (const options of [LINE_ART, SMOOTH]) {
        expect(await traced(art, options), `${canvas} px`).toEqual(
          await traced(painted(canvas, canvas, discInk(canvas), BLACK), options),
        );
      }
    }
  });

  it('reads ink on a shaded paper against the paper beside it', async () => {
    const canvas = 200;
    const art = painted(canvas, canvas, discInk(canvas), [80, 80, 80]);
    for (let p = 0; p < canvas * canvas; p += 1) {
      const paper = 170 + Math.round((85 * (p % canvas)) / canvas);
      if (art.data[p * 4] !== 80) art.data.fill(paper, p * 4, p * 4 + 3);
    }
    expect(await traced(art, LINE_ART)).toEqual(
      await traced(painted(canvas, canvas, discInk(canvas), BLACK), LINE_ART),
    );
  });

  it('leaves soft art and gradients on the measured route', () => {
    const ramp: RawImageData = {
      width: 300,
      height: 200,
      data: Uint8ClampedArray.from({ length: 300 * 200 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : Math.round((255 * ((i >> 2) % 300)) / 300),
      ),
    };
    const images = [64, 100, 150, 400].flatMap((canvas) => [
      softDisc(canvas, 0),
      softDisc(canvas, 80),
    ]);
    for (const options of [LINE_ART, SMOOTH]) {
      for (const image of [...images, ramp]) {
        const native = prepareContourTraceInput(image, options);
        expect(cleanStaircaseSource(image, options, native)).toBeNull();
      }
    }
  });

  it('leaves black-and-white art as it is', () => {
    const image = painted(150, 150, discInk(150), BLACK);
    const native = prepareContourTraceInput(image, LINE_ART);
    expect(cleanStaircaseSource(image, LINE_ART, native)).toBeNull();
  });

  it('goes on reporting what the source itself decided', async () => {
    const reports: TraceReport[] = [];
    const run: TraceStepRunner = (steps) => {
      for (let step = steps.next(false); ; step = steps.next(false)) {
        if (step.done === true) return step.value;
        if (step.value !== undefined) reports.push(step.value);
      }
    };
    await traceImageToColoredPaths(painted(150, 150, discInk(150), [255, 0, 0]), LINE_ART, run);
    expect(reports).toEqual([{ localDetailAdded: true }]);
  });
});

describe('large one-bit curves follow the curve, not the stairs (ADR-530 Amendment 14)', () => {
  // Rolling audit v9 R2-P2-2: the arc evening's window was shorter than the
  // stairs, and a 1024 px disc drew 62 segments at 0.53 px where Potrace drew 13
  // at 0.155 px.
  it.each([
    [512, 8],
    [1024, 10],
    [2048, 16],
  ])(
    'draws the disc on a %i px canvas in few segments near the circle',
    async (canvas, most) => {
      const art = painted(canvas, canvas, discInk(canvas), BLACK);
      for (const options of [LINE_ART, SMOOTH]) {
        const curves = await traced(art, options);
        expect(curves).toHaveLength(1);
        expect((curves[0] as CurveSubpath).segments.length).toBeLessThanOrEqual(most);
        expect(radialError(curves, canvas)).toBeLessThan(0.2);
      }
    },
    30_000,
  );

  it('keeps the long straight sides of a large rounded square straight', async () => {
    const [canvas, near, far, radius] = [600, 100, 500, 40];
    const inkAt: InkAt = (x, y) => {
      const dx = Math.max(near + radius - x - 0.5, x + 0.5 - (far - radius), 0);
      const dy = Math.max(near + radius - y - 0.5, y + 0.5 - (far - radius), 0);
      return Math.hypot(dx, dy) < radius;
    };
    const [curve] = await traced(painted(canvas, canvas, inkAt, BLACK), LINE_ART);
    for (const p of outline(curve as CurveSubpath)) {
      const onSide =
        (p.x > near + radius + 8 && p.x < far - radius - 8) ||
        (p.y > near + radius + 8 && p.y < far - radius - 8);
      if (!onSide) continue;
      const off = Math.min(
        Math.abs(p.x - near),
        Math.abs(far - p.x),
        Math.abs(p.y - near),
        Math.abs(far - p.y),
      );
      expect(off).toBeLessThan(0.3);
    }
  });
});
