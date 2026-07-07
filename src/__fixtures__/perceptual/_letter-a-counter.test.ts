// Repro for the reported defect (2026-07-03): a traced capital "A" outer
// silhouette closes, but the INNER COUNTER (the triangular hole) breaks into
// disconnected pieces — gaps on the counter's left leg and bottom. Builds an
// A from three strokes (two splayed legs + crossbar), traces it through the
// open-polyline presets, renders crops, and measures counter-loop closure.
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_letter-a-counter.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { inkStroke, paper, toRawImage } from './procedural-ink';
import { renderTraceOverlay } from './render-overlay';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const SCALE = 3;
const SUPERSAMPLE = 3;

// A capital "A": apex at top, legs splaying to feet, crossbar. `hollow` keeps
// only the OUTLINE ring of the filled shape (the reported source is a hollow
// outline drawing, not a filled letter — Edge Detection then traces the two
// edges of each thin outline stroke). `soft` renders at 3x then downscales for
// anti-aliased edges emulating a real imported raster.
function letterA(
  legRadius: number,
  hollow: boolean,
  soft: boolean,
  outlineWidthPx = 3,
): RawImageData {
  const s = soft ? SUPERSAMPLE : 1;
  const luma = paper(220 * s, 240 * s);
  const apex: Vec2 = { x: 110 * s, y: 24 * s };
  const leftFoot: Vec2 = { x: 40 * s, y: 210 * s };
  const rightFoot: Vec2 = { x: 180 * s, y: 210 * s };
  inkStroke(luma, apex, leftFoot, legRadius * s);
  inkStroke(luma, apex, rightFoot, legRadius * s);
  inkStroke(luma, { x: 72 * s, y: 150 * s }, { x: 148 * s, y: 150 * s }, legRadius * 0.8 * s);
  if (hollow) hollowOutline(luma, Math.max(1, Math.round(outlineWidthPx * s)));
  const full = toRawImage(luma);
  return soft ? boxDownscale(full, SUPERSAMPLE) : full;
}

// Keep only ink pixels within `width` px of a background pixel — the boundary
// ring of the filled shape, i.e. a hollow outline of the given stroke width.
function hollowOutline(luma: ReturnType<typeof paper>, width: number): void {
  const isInk = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < luma.w && y < luma.h && (luma.px[y * luma.w + x] ?? 255) < 128;
  const keep = new Uint8Array(luma.w * luma.h);
  for (let y = 0; y < luma.h; y += 1) {
    for (let x = 0; x < luma.w; x += 1) {
      if (!isInk(x, y)) continue;
      let nearEdge = false;
      for (let dy = -width; dy <= width && !nearEdge; dy += 1) {
        for (let dx = -width; dx <= width; dx += 1) {
          if (dx * dx + dy * dy <= width * width && !isInk(x + dx, y + dy)) {
            nearEdge = true;
            break;
          }
        }
      }
      if (nearEdge) keep[y * luma.w + x] = 1;
    }
  }
  for (let i = 0; i < luma.px.length; i += 1) luma.px[i] = keep[i] === 1 ? 0 : 255;
}

function boxDownscale(image: RawImageData, factor: number): RawImageData {
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy += 1) {
          for (let dx = 0; dx < factor; dx += 1) {
            sum += image.data[((y * factor + dy) * image.width + (x * factor + dx)) * 4 + c] ?? 255;
          }
        }
        data[(y * width + x) * 4 + c] = sum / (factor * factor);
      }
    }
  }
  return { width, height, data };
}

// The counter region (interior triangle) in source pixels — used to isolate
// the inner loop from the outer silhouette.
const COUNTER = { x0: 74, y0: 60, x1: 146, y1: 148 };

// Traced via the real app entry (traceImageToColoredPaths) so auto-upscale and
// dispatch match what the user sees.
const RUN_TRACE_AUDIT = process.env['TRACE_AUDIT'] === '1';

it.skipIf(!RUN_TRACE_AUDIT)(
  'reproduces + measures A counter closure',
  { timeout: 120000 },
  async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const lines: string[] = [];
    // Thin outline widths: 1-2px collapse to a single Edge ridge (matching the
    // reported single-line render) and are the break-prone regime.
    for (const outlineWidth of [1, 1.5, 2, 3]) {
      for (const soft of [false, true]) {
        const image = letterA(9, true, soft, outlineWidth);
        const options = TRACE_PRESETS['Edge Detection'] as TraceOptions;
        const paths = await traceImageToColoredPaths(image, options);
        const polylines = paths.flatMap((path) => path.polylines);
        const tag = `hollow_w${outlineWidth}_${soft ? 'soft' : 'hard'}_edge`;
        writeFileSync(join(OUT_DIR, `letterA__${tag}.png`), renderOverlay(image, polylines));
        lines.push(describe(tag, polylines));
      }
    }
    writeFileSync(join(OUT_DIR, 'letterA__metrics.txt'), `${lines.join('\n')}\n`);
  },
);

function describe(tag: string, polylines: ReadonlyArray<Polyline>): string {
  const closed = polylines.filter((pl) => pl.closed).length;
  // Chains that pass through the counter region: how many, and do their ends
  // meet? An intact counter is ONE closed loop; gaps show as multiple/open.
  const counter = polylines.filter((pl) =>
    pl.points.some(
      (p) => p.x >= COUNTER.x0 && p.x <= COUNTER.x1 && p.y >= COUNTER.y0 && p.y <= COUNTER.y1,
    ),
  );
  const counterClosed = counter.filter((pl) => pl.closed).length;
  const gaps = openEndGaps(counter);
  return (
    `${tag}: total=${polylines.length} closed=${closed} | ` +
    `counterChains=${counter.length} counterClosed=${counterClosed} ` +
    `counterOpenEndGaps=[${gaps.map((g) => g.toFixed(1)).join(', ')}]`
  );
}

// Distance from each open counter-chain end to the nearest OTHER counter
// geometry — a small nonzero value is a visible break that failed to close.
function openEndGaps(counter: ReadonlyArray<Polyline>): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < counter.length; i += 1) {
    const pl = counter[i];
    if (pl === undefined || pl.closed || pl.points.length < 2) continue;
    for (const end of [pl.points[0], pl.points.at(-1)]) {
      if (end === undefined) continue;
      const best = nearestDistanceExcluding(end, counter, i);
      if (best <= 20) gaps.push(best);
    }
  }
  return gaps.sort((a, b) => a - b);
}

function nearestDistanceExcluding(
  end: Vec2,
  counter: ReadonlyArray<Polyline>,
  skip: number,
): number {
  let best = Infinity;
  for (let j = 0; j < counter.length; j += 1) {
    if (j === skip) continue;
    const other = counter[j];
    if (other === undefined) continue;
    const count = other.points.length + (other.closed ? 0 : -1);
    for (let k = 0; k < count; k += 1) {
      const a = other.points[k];
      const b = other.points[(k + 1) % other.points.length];
      if (a === undefined || b === undefined) continue;
      best = Math.min(best, pointToSegment(end, a, b));
    }
  }
  return best;
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function renderOverlay(image: RawImageData, polylines: ReadonlyArray<Polyline>): Uint8Array {
  const paths: ColoredPath[] = [{ color: '#000000', polylines: [...polylines] }];
  // Shared overlay renderer keeps colours consistent with the other audit
  // crops (closed = red, open = blue).
  return renderTraceOverlay(image, paths, SCALE);
}
