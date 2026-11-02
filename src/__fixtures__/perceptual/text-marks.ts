// The small marks of rendered text (i-dots, full stops, colon dots) and whether
// a trace kept them, for the automatic-decision trace tests. An anti-aliased
// mark is judged on its own ink: the trace must cover at least half of the
// glyph's 4 x 4 samples inside the mark, so a 2 px stop at a half-pixel phase
// is not judged on which pixel centres it happens to cover. A 1-bit mark is
// judged on its own pixels.
//
// Test-only helper: lives under src/__fixtures__. Pure and deterministic.

import type { ColoredPath } from '../../core/scene';
import type { RawImageData } from '../../core/trace';
import type { RenderedText } from './degraded-text';
import { rasterizeColoredPaths, type Mask } from './rasterize';

const SAMPLES = 4;

// Eight-connected components under 12 px² of ink, on a grid of `samples` x
// `samples` per pixel.
export function smallMarks(mask: Mask, samples = SAMPLES): number[][] {
  return components(mask).filter((c) => c.length < 12 * samples * samples);
}

// The image's own ink, luma <= 128.
export function inkMask(image: RawImageData): Mask {
  const data = new Uint8Array(image.width * image.height);
  for (let p = 0; p < data.length; p += 1) data[p] = (image.data[p * 4] ?? 255) <= 128 ? 1 : 0;
  return { width: image.width, height: image.height, data };
}

// The marks the trace covers less than `share` of, as each mark's leftmost x
// (image px), with the trace rasterised on the truth's own sample grid.
export function lostMarks(
  rendered: RenderedText,
  paths: ReadonlyArray<ColoredPath>,
  marks: ReadonlyArray<number[]>,
  share = 0.5,
): number[] {
  const fine = rasterizeColoredPaths(
    paths.map((path) => ({
      ...path,
      polylines: path.polylines.map((pl) => ({
        ...pl,
        points: pl.points.map((p) => ({ x: p.x * SAMPLES, y: p.y * SAMPLES })),
      })),
    })),
    rendered.truth.width,
    rendered.truth.height,
  );
  return marks
    .filter((m) => m.filter((q) => fine.data[q] === 1).length < share * m.length)
    .map((m) => Math.floor(Math.min(...m.map((q) => q % fine.width)) / SAMPLES));
}

// Eight-connected components of the mask's ink.
function components(mask: Mask): number[][] {
  const seen = new Uint8Array(mask.data.length);
  const out: number[][] = [];
  for (let start = 0; start < mask.data.length; start += 1) {
    if (seen[start] === 1 || mask.data[start] !== 1) continue;
    const pixels: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() ?? 0;
      pixels.push(p);
      for (const q of neighbours(mask, p)) {
        if (seen[q] === 1 || mask.data[q] !== 1) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push(pixels);
  }
  return out;
}

function neighbours(mask: Mask, p: number): number[] {
  const x = p % mask.width;
  const y = (p - x) / mask.width;
  const out: number[] = [];
  for (let ny = Math.max(0, y - 1); ny <= Math.min(mask.height - 1, y + 1); ny += 1)
    for (let nx = Math.max(0, x - 1); nx <= Math.min(mask.width - 1, x + 1); nx += 1)
      if (nx !== x || ny !== y) out.push(ny * mask.width + nx);
  return out;
}
