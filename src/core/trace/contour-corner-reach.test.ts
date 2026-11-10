import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ColoredPath, CurveSubpath, PathSegment, Vec2 } from '../scene';
import { textToPolylines } from '../text/text-to-polylines';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';

// One glyph at `px` px per em, 1-bit at pixel centres (a pixel is ink when its
// centre is inside, even-odd), its outline placed off the pixel grid by
// (+0.31, +0.17) inside a margin, with the flattened true outline.
async function bitGlyph(
  font: string,
  char: string,
  px: number,
): Promise<{ readonly image: RawImageData; readonly rings: Vec2[][] }> {
  const bytes = readFileSync(resolve('src/ui/text/fonts', font));
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
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let row = 0; row < height; row += 1) {
    const y = row + 0.5;
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
      const from = Math.max(0, Math.ceil((crossings[k] as number) - 0.5));
      const to = Math.min(width, Math.ceil((crossings[k + 1] as number) - 0.5));
      for (let x = from; x < to; x += 1) data.set([0, 0, 0], (row * width + x) * 4);
    }
  }
  return { image: { width, height, data }, rings };
}

// Distance from `p` to the true outline.
function offOutline(rings: ReadonlyArray<ReadonlyArray<Vec2>>, p: Vec2): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[j] as Vec2;
      const b = ring[i] as Vec2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
    }
  }
  return best;
}

function tangents(from: Vec2, segment: PathSegment): { readonly start: Vec2; readonly end: Vec2 } {
  const to = segment.to;
  const chord = { x: to.x - from.x, y: to.y - from.y };
  if (segment.kind !== 'cubic') return { start: chord, end: chord };
  const pick = (a: Vec2, b: Vec2, c: Vec2): Vec2 =>
    Math.hypot(a.x - b.x, a.y - b.y) > 1e-9 ? { x: a.x - b.x, y: a.y - b.y } : c;
  return {
    start: pick(segment.control1, from, pick(segment.control2, from, chord)),
    end: pick(to, segment.control2, pick(to, segment.control1, chord)),
  };
}

// The joints of every closed outline where it turns by 90 degrees or more.
function sharpNodes(paths: ReadonlyArray<ColoredPath>): Vec2[] {
  const out: Vec2[] = [];
  for (const curve of paths.flatMap((path) => path.curves ?? []) as CurveSubpath[]) {
    const segments = curve.segments;
    const starts: Vec2[] = [];
    let at = curve.start;
    for (const segment of segments) {
      starts.push(at);
      at = segment.to;
    }
    for (let k = 0; k < segments.length; k += 1) {
      const before = (k - 1 + segments.length) % segments.length;
      const incoming = tangents(starts[before] as Vec2, segments[before] as PathSegment).end;
      const outgoing = tangents(starts[k] as Vec2, segments[k] as PathSegment).start;
      const turn = Math.atan2(
        incoming.x * outgoing.y - incoming.y * outgoing.x,
        incoming.x * outgoing.x + incoming.y * outgoing.y,
      );
      if (Math.abs(turn) >= Math.PI / 2) out.push(starts[k] as Vec2);
    }
  }
  return out;
}

describe('short-leg binary apexes stay within the chain reach (ADR-439 Amendment 4)', () => {
  // The legs of a narrow stroke's flat end (a foot, a serif's end, the top of
  // a 7) or of a short tilted face meet two to four pixels past the cut, and
  // the needle threads between paper centres, so Amendment 1's bound let it
  // through: before this amendment these drew sharp nodes 1.0 to 2.0 px off
  // the true outline (Roboto A at 24 px 2.0 px). Potrace 1.16 draws none.
  it.each([
    ['Roboto-Regular.ttf', 'A', 24],
    ['Roboto-Regular.ttf', 'K', 24],
    ['Roboto-Regular.ttf', 'k', 32],
    ['Roboto-Regular.ttf', 'y', 32],
    ['Tinos-Regular.ttf', '7', 24],
    ['Tinos-Regular.ttf', 'k', 48],
  ] as const)('draws no spike on 1-bit %s %s at %i px', async (font, char, px) => {
    const { image, rings } = await bitGlyph(font, char, px);
    for (const preset of ['Line Art', 'Smooth', 'Sharp']) {
      const paths = await traceImageToColoredPaths(image, TRACE_PRESETS[preset] as TraceOptions);
      for (const node of sharpNodes(paths)) {
        expect(offOutline(rings, node), `${preset} at (${node.x}, ${node.y})`).toBeLessThan(1);
      }
    }
  });
});
