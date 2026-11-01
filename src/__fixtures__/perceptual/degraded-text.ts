// Rendered small text and the degradations a scan or a phone picture adds,
// for the automatic-decision trace tests (quality audit Q4 and Q5). Glyph
// outlines come from the shipped Roboto font through opentype.js; each pixel
// is ink in proportion to the glyph area covering it (4 x 4 box samples), or,
// for a 1-bit render, when its centre is inside a glyph.
//
// Test-only helper: lives under src/__fixtures__. Pure and deterministic.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Polyline, Vec2 } from '../../core/scene';
import type { RawImageData } from '../../core/trace';
import { parseOutlineFont } from '../../core/text/text-to-polylines';
import { rasterizePolylines, type Mask } from './rasterize';

type Font = Awaited<ReturnType<typeof parseOutlineFont>>;

const AA_SAMPLES = 4;
const CURVE_STEPS = 16;

/** A shipped font: the text tool's own by default, or one from `dir` (for
 *  example the PDF importer's Arial-metric Liberation Sans). */
export async function loadFont(file = 'Roboto-Regular.ttf', dir = 'ui/text/fonts'): Promise<Font> {
  const bytes = readFileSync(resolve(__dirname, '../..', dir, file));
  return parseOutlineFont(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

export type RenderedText = {
  readonly image: RawImageData;
  /** The glyphs' own ink at 4 x 4 samples per pixel: the counters' truth. */
  readonly truth: Mask;
};

/** `text` at an em size of `px`, ink on paper, anti-aliased or 1-bit. The
 *  baseline sits off the pixel grid, as a scan's would. */
export function renderText(
  font: Font,
  text: string,
  px: number,
  options: { readonly antiAliased: boolean; readonly ink: number; readonly paper: number },
): RenderedText {
  const path = font.getPath(text, 8.31, px + 6.17, px);
  const box = path.getBoundingBox();
  const width = Math.ceil(box.x2 + 8);
  const height = Math.ceil(box.y2 + 8);
  const outlines = flattenCommands(path.commands);
  const truth = rasterizePolylines(
    scaled(outlines, AA_SAMPLES),
    width * AA_SAMPLES,
    height * AA_SAMPLES,
  );
  const centres = options.antiAliased ? null : rasterizePolylines(outlines, width, height);
  return {
    image: greyImage(width, height, (x, y) => {
      const coverage =
        centres === null ? boxCoverage(truth, x, y) : (centres.data[y * width + x] ?? 0);
      return options.paper - (options.paper - options.ink) * coverage;
    }),
    truth,
  };
}

/** Separable Gaussian blur (radius 3σ, clamped borders), per channel. */
export function gaussianBlur(image: RawImageData, sigma: number): RawImageData {
  const radius = Math.ceil(3 * sigma);
  const kernel: number[] = [];
  for (let i = -radius; i <= radius; i += 1) kernel.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const weights = kernel.map((k) => k / sum);
  const pass = (source: RawImageData, dx: number, dy: number): RawImageData =>
    mapChannels(source, (x, y, c) => {
      let v = 0;
      for (let i = -radius; i <= radius; i += 1) {
        v += (weights[i + radius] ?? 0) * channelAt(source, x + i * dx, y + i * dy, c);
      }
      return v;
    });
  return pass(pass(image, 1, 0), 0, 1);
}

/** The image as a camera k times coarser saw it: k x k box averages,
 *  enlarged back bilinearly between the coarse pixels' centres. */
export function lowResolution(image: RawImageData, k: number): RawImageData {
  const cw = Math.ceil(image.width / k);
  const ch = Math.ceil(image.height / k);
  const coarse = new Float64Array(cw * ch * 3);
  for (let cy = 0; cy < ch; cy += 1)
    for (let cx = 0; cx < cw; cx += 1)
      for (let c = 0; c < 3; c += 1) {
        let v = 0;
        for (let j = 0; j < k; j += 1)
          for (let i = 0; i < k; i += 1) v += channelAt(image, cx * k + i, cy * k + j, c);
        coarse[(cy * cw + cx) * 3 + c] = v / (k * k);
      }
  const at = (x: number, y: number, c: number): number =>
    coarse[(Math.min(ch - 1, Math.max(0, y)) * cw + Math.min(cw - 1, Math.max(0, x))) * 3 + c] ?? 0;
  return mapChannels(image, (x, y, c) => {
    const gx = (x + 0.5) / k - 0.5;
    const gy = (y + 0.5) / k - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
    const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
    return top * (1 - fy) + bottom * fy;
  });
}

/** Sensor grain: the same N(0, σ) draw added to R, G and B (mulberry32 seed,
 *  Box-Muller), the draw that flipped the lighting gate in audit Q5. */
export function monoGrain(image: RawImageData, sigma: number, seed: number): RawImageData {
  const random = mulberry32(seed);
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    let u = 0;
    while (u === 0) u = random();
    const n = sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.round((image.data[i + c] ?? 0) + n);
  }
  return { width: image.width, height: image.height, data };
}

export function greyImage(
  width: number,
  height: number,
  luma: (x: number, y: number) => number,
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const v = Math.round(luma(x, y));
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function channelAt(image: RawImageData, x: number, y: number, c: number): number {
  const cx = Math.min(image.width - 1, Math.max(0, x));
  const cy = Math.min(image.height - 1, Math.max(0, y));
  return image.data[(cy * image.width + cx) * 4 + c] ?? 0;
}

function mapChannels(
  image: RawImageData,
  value: (x: number, y: number, channel: number) => number,
): RawImageData {
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1) {
      const o = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c += 1) data[o + c] = Math.round(value(x, y, c));
      data[o + 3] = 255;
    }
  return { width: image.width, height: image.height, data };
}

function boxCoverage(fine: Mask, x: number, y: number): number {
  let inked = 0;
  for (let j = 0; j < AA_SAMPLES; j += 1)
    for (let i = 0; i < AA_SAMPLES; i += 1)
      inked += fine.data[(y * AA_SAMPLES + j) * fine.width + x * AA_SAMPLES + i] ?? 0;
  return inked / (AA_SAMPLES * AA_SAMPLES);
}

function scaled(outlines: ReadonlyArray<Polyline>, factor: number): Polyline[] {
  return outlines.map((pl) => ({
    closed: true,
    points: pl.points.map((p) => ({ x: p.x * factor, y: p.y * factor })),
  }));
}

type PathCommand = { readonly type: string } & Partial<
  Record<'x' | 'y' | 'x1' | 'y1' | 'x2' | 'y2', number>
>;

// opentype path commands to closed polylines, curves flattened.
function flattenCommands(commands: ReadonlyArray<PathCommand>): Polyline[] {
  const outlines: Polyline[] = [];
  let ring: Vec2[] = [];
  let pen: Vec2 = { x: 0, y: 0 };
  const close = (): void => {
    if (ring.length > 2) outlines.push({ closed: true, points: ring });
    ring = [];
  };
  for (const c of commands) {
    const end = { x: c.x ?? 0, y: c.y ?? 0 };
    if (c.type === 'M') {
      close();
      ring = [end];
    } else if (c.type === 'Z') {
      close();
      continue;
    } else {
      for (let k = 1; k <= (c.type === 'L' ? 1 : CURVE_STEPS); k += 1) {
        ring.push(curvePoint(c, pen, end, k / CURVE_STEPS));
      }
    }
    pen = end;
  }
  close();
  return outlines;
}

function curvePoint(c: PathCommand, p0: Vec2, p3: Vec2, t: number): Vec2 {
  if (c.type === 'L') return p3;
  const u = 1 - t;
  const c1 = { x: c.x1 ?? 0, y: c.y1 ?? 0 };
  if (c.type === 'Q') {
    return {
      x: u * u * p0.x + 2 * u * t * c1.x + t * t * p3.x,
      y: u * u * p0.y + 2 * u * t * c1.y + t * t * p3.y,
    };
  }
  const c2 = { x: c.x2 ?? 0, y: c.y2 ?? 0 };
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}
