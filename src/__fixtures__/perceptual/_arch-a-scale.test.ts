// Reproduce the ARCH "A" counter gaps by scale + sensitivity sweep. The
// default preset at 1024px closes the counter; the user sees gaps, so this
// searches the conditions that break it (smaller working size → thinner
// counter edges; lower sensitivity → higher Canny thresholds drop runs).
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_arch-a-scale.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';
import { renderTraceOverlay } from './render-overlay';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
// The ARCH "A" counter (triangular hole) in FULL-res source pixels; scaled per
// trace so the closure check follows the letter at any working size.
const A_COUNTER_FULL = { x0: 150, y0: 585, x1: 235, y1: 655 };
const EDGE = TRACE_PRESETS['Edge Detection'] as TraceOptions;
const RUN_TRACE_AUDIT = process.env['TRACE_AUDIT'] === '1';

it.skipIf(!RUN_TRACE_AUDIT)(
  'sweeps scale + sensitivity for the ARCH A counter',
  { timeout: 240000 },
  async () => {
    const fixture = requiredArchHouseFixtureStatus();
    if (fixture.path === null) throw new Error('arch-house fixture missing');
    mkdirSync(OUT_DIR, { recursive: true });
    const full = decodePngFile(fixture.path);
    const lines: string[] = [];
    for (const scale of [1, 0.75, 0.5, 0.35]) {
      const image = scale === 1 ? full : bilinearScale(full, scale);
      const band = scaleBand(A_COUNTER_FULL, scale);
      for (const sens of ['default', 'low', 'high'] as const) {
        const options = withSensitivity(EDGE, sens);
        const paths = await traceImageToColoredPaths(image, options);
        const polylines = paths.flatMap((p) => p.polylines);
        const stat = counterClosure(polylines, band);
        lines.push(
          `scale=${scale} sens=${sens}: counterChains=${stat.chains} closed=${stat.closed} ` +
            `open=${stat.open} nearGaps=[${stat.gaps.map((g) => g.toFixed(1)).join(', ')}]`,
        );
        if (sens === 'default') {
          writeFileSync(
            join(OUT_DIR, `archA__scale${scale}.png`),
            cropRender(image, polylines, band),
          );
        }
      }
    }
    writeFileSync(join(OUT_DIR, 'archA__scale-sweep.txt'), `${lines.join('\n')}\n`);
  },
);

function withSensitivity(base: TraceOptions, sens: 'default' | 'low' | 'high'): TraceOptions {
  if (sens === 'default') return base;
  // Sensitivity slider maps inversely to Canny thresholds: LOW sensitivity =
  // higher thresholds (drops weak edges → gaps); HIGH = lower thresholds.
  const factor = sens === 'low' ? 1.8 : 0.5;
  return {
    ...base,
    edgeLowThresholdRatio: (base.edgeLowThresholdRatio ?? 0.08) * factor,
    edgeHighThresholdRatio: (base.edgeHighThresholdRatio ?? 0.2) * factor,
  };
}

type ClosureStat = {
  readonly chains: number;
  readonly closed: number;
  readonly open: number;
  readonly gaps: number[];
};

function counterClosure(polylines: ReadonlyArray<Polyline>, band: Vec4): ClosureStat {
  const counter = polylines.filter((pl) =>
    pl.points.some((p) => p.x >= band.x0 && p.x <= band.x1 && p.y >= band.y0 && p.y <= band.y1),
  );
  const gaps: number[] = [];
  for (let i = 0; i < counter.length; i += 1) {
    const pl = counter[i];
    if (pl === undefined || pl.closed || pl.points.length < 2) continue;
    for (const end of [pl.points[0], pl.points.at(-1)]) {
      if (end === undefined) continue;
      const d = nearestOther(end, counter, i);
      if (d > 0.1 && d <= 25) gaps.push(d);
    }
  }
  return {
    chains: counter.length,
    closed: counter.filter((pl) => pl.closed).length,
    open: counter.filter((pl) => !pl.closed).length,
    gaps: gaps.sort((a, b) => a - b),
  };
}

function nearestOther(end: Vec2, counter: ReadonlyArray<Polyline>, skip: number): number {
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

type Vec4 = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

function scaleBand(band: Vec4, scale: number): Vec4 {
  return { x0: band.x0 * scale, y0: band.y0 * scale, x1: band.x1 * scale, y1: band.y1 * scale };
}

function cropRender(
  image: RawImageData,
  polylines: ReadonlyArray<Polyline>,
  band: Vec4,
): Uint8Array {
  const pad = 30;
  const x0 = Math.max(0, Math.floor(band.x0 - pad));
  const y0 = Math.max(0, Math.floor(band.y0 - pad));
  const x1 = Math.min(image.width, Math.ceil(band.x1 + pad));
  const y1 = Math.min(image.height, Math.ceil(band.y1 + pad));
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = ((y0 + y) * image.width + (x0 + x)) * 4;
      const dst = (y * w + x) * 4;
      for (let c = 0; c < 4; c += 1) data[dst + c] = image.data[src + c] ?? 255;
    }
  }
  const shifted: ColoredPath[] = [
    {
      color: '#000000',
      polylines: polylines.map((pl) => ({
        closed: pl.closed,
        points: pl.points.map((p) => ({ x: p.x - x0, y: p.y - y0 })),
      })),
    },
  ];
  return renderTraceOverlay({ width: w, height: h, data }, shifted, 6);
}

function bilinearScale(image: RawImageData, scale: number): RawImageData {
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(image.width - 1, (x + 0.5) / scale - 0.5);
      const sy = Math.min(image.height - 1, (y + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const y1 = Math.min(image.height - 1, y0 + 1);
      const tx = sx - x0;
      const ty = sy - y0;
      for (let c = 0; c < 4; c += 1) {
        const p00 = image.data[(y0 * image.width + x0) * 4 + c] ?? 255;
        const p10 = image.data[(y0 * image.width + x1) * 4 + c] ?? 255;
        const p01 = image.data[(y1 * image.width + x0) * 4 + c] ?? 255;
        const p11 = image.data[(y1 * image.width + x1) * 4 + c] ?? 255;
        const top = p00 * (1 - tx) + p10 * tx;
        const bottom = p01 * (1 - tx) + p11 * tx;
        data[(y * w + x) * 4 + c] = top * (1 - ty) + bottom * ty;
      }
    }
  }
  return { width: w, height: h, data };
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
