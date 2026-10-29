import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { jpegRoundTrip } from '../../__fixtures__/perceptual/jpeg-roundtrip';
import type { ColoredPath, CurveSubpath, PathSegment, Vec2 } from '../scene';
import { textToPolylines } from '../text/text-to-polylines';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';

// Binary shapes as quality audit Q4 drew them: a pixel is ink when its centre
// is inside, the shape centred off the pixel grid by (+0.31, +0.17).
type Shape = { readonly canvas: number; readonly inside: (x: number, y: number) => boolean };

function render(shape: Shape): RawImageData {
  const { canvas } = shape;
  const data = new Uint8ClampedArray(canvas * canvas * 4).fill(255);
  for (let y = 0; y < canvas; y += 1) {
    for (let x = 0; x < canvas; x += 1) {
      if (shape.inside(x + 0.5, y + 0.5)) data.set([0, 0, 0], (y * canvas + x) * 4);
    }
  }
  return { width: canvas, height: canvas, data };
}

function margin(size: number): number {
  return Math.max(6, Math.round(size * 0.25));
}

// size x 0.6 size with corner radius 0.15 size: a shape with no corners.
function roundedRect(size: number): Shape & { readonly distance: (p: Vec2) => number } {
  const canvas = size + 2 * margin(size);
  const cx = canvas / 2 + 0.31;
  const cy = canvas / 2 + 0.17;
  const r = 0.15 * size;
  const hx = size / 2 - r;
  const hy = 0.3 * size - r;
  const signed = (x: number, y: number): number => {
    const qx = Math.abs(x - cx) - hx;
    const qy = Math.abs(y - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  return {
    canvas,
    inside: (x, y) => signed(x, y) < 0,
    distance: (p) => Math.abs(signed(p.x, p.y)),
  };
}

function polygon(
  size: number,
  vertices: ReadonlyArray<Vec2>,
): Shape & { readonly corners: Vec2[] } {
  const canvas = size + 2 * margin(size);
  const cx = canvas / 2 + 0.31;
  const cy = canvas / 2 + 0.17;
  const corners = vertices.map((v) => ({ x: v.x + cx, y: v.y + cy }));
  const inside = (x: number, y: number): boolean => {
    let odd = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
      const p = corners[i] as Vec2;
      const q = corners[j] as Vec2;
      if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) odd = !odd;
    }
    return odd;
  };
  return { canvas, inside, corners };
}

function rotated(points: ReadonlyArray<Vec2>, degrees: number): Vec2[] {
  const a = (degrees * Math.PI) / 180;
  return points.map((p) => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  }));
}

// Square of side `size` turned 17 degrees.
function turnedSquare(size: number): ReturnType<typeof polygon> {
  const h = size / 2;
  return polygon(
    size,
    rotated(
      [
        { x: -h, y: -h },
        { x: h, y: -h },
        { x: h, y: h },
        { x: -h, y: h },
      ],
      17,
    ),
  );
}

// Isosceles triangle with that apex angle, longest side `size`, turned 7 degrees.
function triangle(apexDegrees: number): (size: number) => ReturnType<typeof polygon> {
  return (size) => {
    const half = (apexDegrees * Math.PI) / 360;
    const leg = Math.min(size, size / (2 * Math.sin(half)));
    const verts = [
      { x: 0, y: 0 },
      { x: leg * Math.sin(half), y: leg * Math.cos(half) },
      { x: -leg * Math.sin(half), y: leg * Math.cos(half) },
    ];
    const cy = (2 * leg * Math.cos(half)) / 3;
    return polygon(
      size,
      rotated(
        verts.map((p) => ({ x: p.x, y: p.y - cy })),
        7,
      ),
    );
  };
}

type Node = Vec2 & { readonly turnDeg: number };

function tangents(from: Vec2, segment: PathSegment): { readonly start: Vec2; readonly end: Vec2 } {
  const to = segment.to;
  if (segment.kind !== 'cubic') {
    const chord = { x: to.x - from.x, y: to.y - from.y };
    return { start: chord, end: chord };
  }
  const pick = (a: Vec2, b: Vec2, c: Vec2): Vec2 =>
    Math.hypot(a.x - b.x, a.y - b.y) > 1e-9 ? { x: a.x - b.x, y: a.y - b.y } : c;
  const chord = { x: to.x - from.x, y: to.y - from.y };
  return {
    start: pick(segment.control1, from, pick(segment.control2, from, chord)),
    end: pick(to, segment.control2, pick(to, segment.control1, chord)),
  };
}

// The joints of every closed outline with the turn the outline makes there.
function nodes(paths: ReadonlyArray<ColoredPath>): Node[] {
  const out: Node[] = [];
  for (const curve of paths.flatMap((path) => path.curves ?? []) as CurveSubpath[]) {
    const segments = curve.segments;
    const starts: Vec2[] = [];
    let at = curve.start;
    for (const segment of segments) {
      starts.push(at);
      at = segment.to;
    }
    for (let k = 0; k < segments.length; k += 1) {
      const prev = segments[(k - 1 + segments.length) % segments.length] as PathSegment;
      const prevFrom = starts[(k - 1 + segments.length) % segments.length] as Vec2;
      const incoming = tangents(prevFrom, prev).end;
      const outgoing = tangents(starts[k] as Vec2, segments[k] as PathSegment).start;
      const turn = Math.atan2(
        incoming.x * outgoing.y - incoming.y * outgoing.x,
        incoming.x * outgoing.x + incoming.y * outgoing.y,
      );
      out.push({ ...(starts[k] as Vec2), turnDeg: (Math.abs(turn) * 180) / Math.PI });
    }
  }
  return out;
}

const PRESETS = ['Line Art', 'Smooth'] as const;

function trace(image: RawImageData, preset: string): Promise<ColoredPath[]> {
  return traceImageToColoredPaths(image, TRACE_PRESETS[preset] as TraceOptions);
}

describe('binary corner apexes stay on the ink (ADR-439 Amendment 1)', () => {
  // Quality audit Q4-P2-2: leg apexes extrapolated past the pixels drew sharp
  // nodes 1 to 3.4 px off the true outline. A rounded rectangle has no corner,
  // so a sharp node more than a pixel off it is such a spike (natively, before
  // this bound: 1.8 px at 32 px, 2.6 px at 16 px, 2.5 px at 64 px).
  it.each([16, 32, 64])('draws no spike on a %i px rounded rectangle', async (size) => {
    const shape = roundedRect(size);
    for (const preset of PRESETS) {
      const sharp = nodes(await trace(render(shape), preset)).filter((n) => n.turnDeg >= 60);
      for (const node of sharp) expect(shape.distance(node)).toBeLessThan(1);
    }
  });

  // The bound must not withdraw true corners: without its leg slack it dropped
  // one corner of each of these.
  it.each([
    ['turned square', 64, turnedSquare],
    ['turned square', 200, turnedSquare],
    ['60 degree triangle', 32, triangle(60)],
    ['120 degree triangle', 32, triangle(120)],
  ] as const)('keeps every corner of a %s at %i px sharp', async (_name, size, make) => {
    const shape = make(size);
    for (const preset of PRESETS) {
      const sharp = nodes(await trace(render(shape), preset)).filter((n) => n.turnDeg >= 30);
      for (const corner of shape.corners) {
        const nearest = Math.min(...sharp.map((n) => Math.hypot(n.x - corner.x, n.y - corner.y)));
        expect(nearest).toBeLessThan(0.75);
      }
    }
  });
});

// ——— anti-aliased serif text ———

const SERIF_FONT = 'Tinos-Regular.ttf';
const COVERAGE_SAMPLES = 8;
// A pixel this light or lighter carries no ink (under 2% coverage).
const PAPER_LUMA = 250;

// One glyph of the bundled serif at `px` px per em, anti-aliased by an 8 x 8
// coverage sample per pixel (even-odd), its ink placed off the pixel grid by
// (+0.31, +0.17) inside a margin.
async function serifGlyph(char: string, px: number): Promise<RawImageData> {
  const bytes = readFileSync(resolve('src/ui/text/fonts', SERIF_FONT));
  const fontBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const rendered = await textToPolylines({
    fontBuffer: fontBuffer as ArrayBuffer,
    content: char,
    sizeMm: px,
    alignment: 'left',
    lineHeight: 1,
    color: '#000000',
  });
  const pad = Math.max(6, Math.round(px * 0.15));
  const { minX, minY, maxX, maxY } = rendered.bounds;
  const rings = rendered.paths
    .flatMap((path) => path.polylines)
    .map((line) =>
      line.points.map((p) => ({ x: p.x - minX + pad + 0.31, y: p.y - minY + pad + 0.17 })),
    );
  const width = Math.ceil(maxX - minX + 2 * pad);
  const height = Math.ceil(maxY - minY + 2 * pad);
  const covered = new Float64Array(width * height);
  for (let row = 0; row < height * COVERAGE_SAMPLES; row += 1) {
    const y = (row + 0.5) / COVERAGE_SAMPLES;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const p = ring[i] as Vec2;
        const q = ring[j] as Vec2;
        if (p.y > y !== q.y > y) crossings.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] as number) * COVERAGE_SAMPLES - 0.5));
      const to = Math.min(
        width * COVERAGE_SAMPLES,
        Math.ceil((crossings[k + 1] as number) * COVERAGE_SAMPLES - 0.5),
      );
      const base = Math.floor(row / COVERAGE_SAMPLES) * width;
      for (let s = from; s < to; s += 1) {
        const pixel = base + Math.floor(s / COVERAGE_SAMPLES);
        covered[pixel] = (covered[pixel] as number) + 1;
      }
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  covered.forEach((count, p) => {
    const luma = Math.round(255 * (1 - count / COVERAGE_SAMPLES ** 2));
    data.set([luma, luma, luma, 255], p * 4);
  });
  return { width, height, data };
}

// How far `p` stands from every pixel that carries ink: 0 on or beside ink.
function intoPaper(image: RawImageData, p: Vec2): number {
  let best = Infinity;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((image.data[(y * image.width + x) * 4] as number) >= PAPER_LUMA) continue;
      const dx = Math.max(x - p.x, 0, p.x - x - 1);
      const dy = Math.max(y - p.y, 0, p.y - y - 1);
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best;
}

describe('measured corner apexes stay on the field ink (ADR-439 Amendment 2)', () => {
  // Rolling audit v8 N8-P2-4: on anti-aliased Tinos the legs of a serif's
  // blunt end met past it, and Line Art drew sharp nodes up to 1.7 px into
  // pure paper (N at 32 px), Sharp up to 2.5 px (M at 36 px). Potrace drew none.
  it.each([24, 32, 40])(
    'draws no node into the paper of anti-aliased serif text at %i px',
    async (px) => {
      for (const char of ['A', 'K', 'M', 'N', 'R', 'W']) {
        const image = await serifGlyph(char, px);
        for (const preset of ['Line Art', 'Smooth', 'Sharp']) {
          for (const node of nodes(await trace(image, preset))) {
            expect(
              intoPaper(image, node),
              `${preset} ${char} at (${node.x}, ${node.y})`,
            ).toBeLessThanOrEqual(0.5);
          }
        }
      }
    },
  );
});

// The 1-bit picture of an anti-aliased one (a pixel is ink when it is mostly
// covered), optionally after a JPEG round trip at `quality`.
function oneBit(image: RawImageData, quality?: number): RawImageData {
  const { width, height } = image;
  const luma = Array.from({ length: width * height }, (_, p) =>
    (image.data[p * 4] as number) < 128 ? 0 : 255,
  );
  const values = quality === undefined ? luma : jpegRoundTrip(luma, width, height, quality);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    const value = values[p] as number;
    data.set([value, value, value, 255], p * 4);
  }
  return { width, height, data };
}

// Points along every traced outline, a sixteenth of each segment apart.
function outlinePoints(paths: ReadonlyArray<ColoredPath>): Vec2[] {
  const points: Vec2[] = [];
  for (const curve of paths.flatMap((path) => path.curves ?? []) as CurveSubpath[]) {
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
        const { control1: p1, control2: p2, to } = segment;
        points.push({
          x: a * at.x + b * p1.x + c * p2.x + d * to.x,
          y: a * at.y + b * p1.y + c * p2.y + d * to.y,
        });
      }
      at = segment.to;
    }
  }
  return points;
}

describe('a JPEG of two-level text traces as the clean text (ADR-530 Amendment 12)', () => {
  // Placed at the field's crossing, a quality 60 JPEG's ringing moved the
  // cracks of the source-grid walk up to 0.15 px and tilted the short legs of
  // serifs into spikes 1.4 to 2.9 px off the clean outline; main's enlarged
  // walk drew the staircase 1.8 to 6.3 px off it. A crack the ringing leaves
  // too uneven to be a step keeps its crossing, so a node may move a little.
  it.each([24, 32])(
    'draws a quality 60 JPEG of 1-bit serif text at %i px on the clean outline',
    async (px) => {
      for (const char of ['A', 'M', 'N', 'R']) {
        const image = await serifGlyph(char, px);
        for (const preset of PRESETS) {
          const clean = outlinePoints(await trace(oneBit(image), preset));
          for (const node of nodes(await trace(oneBit(image, 60), preset))) {
            const off = Math.min(...clean.map((p) => Math.hypot(p.x - node.x, p.y - node.y)));
            expect(off, `${preset} ${char} at (${node.x}, ${node.y})`).toBeLessThanOrEqual(1);
          }
        }
      }
    },
  );
});
