// Cross-tracer upgrade audit (2026-07-03): renders every preset over a
// diagnostic fixture battery and prints comparable quality metrics, so the
// maintainer can see per-tracer weaknesses side by side. Report-only
// instrumentation — no production behaviour. Gated like the other audit
// harnesses:
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_tracer-upgrade-audit.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { it } from 'vitest';
import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { LANGEBAAN_BAND, measureBandExcessTurnPer100Px } from './arch-house-edge-truth';
import { sampleByArcLength } from './centerline-geometry';
import { compareMasks } from './compare';
import { NOISY_PHOTO_EDGE_FIXTURE } from './edge-truth';
import { inkDisc, paper, toRawImage } from './procedural-ink';
import { decodePngFile } from './png-decode';
import { renderTraceOverlay } from './render-overlay';
import { rasterizeColoredPaths, type Mask } from './rasterize';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const PRESETS = ['Line Art', 'Smooth', 'Sharp', 'Centerline', 'Edge Detection'] as const;
const INK_LUMA_MAX = 128;
const STAR_TIPS = 12;
const STAR_CENTER = 100;
const STAR_OUTER_R = 80;
const STAR_INNER_R = 45;

type FixtureName = 'arch' | 'smalltext' | 'disc' | 'star' | 'photo';

it(
  'renders every tracer over the diagnostic battery with metrics',
  { timeout: 600000 },
  async () => {
    if (process.env['TRACE_AUDIT'] !== '1') return;
    const fixture = requiredArchHouseFixtureStatus();
    if (fixture.path === null) throw new Error('arch-house fixture missing');
    mkdirSync(OUT_DIR, { recursive: true });
    const arch = decodePngFile(fixture.path);
    const battery: ReadonlyArray<{ name: FixtureName; image: RawImageData; scale: number }> = [
      { name: 'arch', image: arch, scale: 1 },
      { name: 'smalltext', image: downscaleHalf(cropBand(arch)), scale: 6 },
      { name: 'disc', image: discImage(), scale: 2 },
      { name: 'star', image: starImage(), scale: 2 },
      { name: 'photo', image: NOISY_PHOTO_EDGE_FIXTURE.image, scale: 3 },
    ];
    const lines: string[] = [];
    for (const preset of PRESETS) {
      const options = TRACE_PRESETS[preset] as TraceOptions;
      lines.push(`=== ${preset} ===`);
      for (const item of battery) {
        const t0 = performance.now();
        const paths = await traceImageToColoredPaths(item.image, options);
        const ms = performance.now() - t0;
        lines.push(describeResult(item.name, item.image, options, paths, ms));
        const png = renderTraceOverlay(item.image, paths, item.scale);
        writeFileSync(join(OUT_DIR, `tracer__${item.name}__${slug(preset)}.png`), png);
      }
      lines.push('');
    }
    writeFileSync(join(OUT_DIR, 'tracer__metrics.txt'), `${lines.join('\n')}\n`);
  },
);

function describeResult(
  name: FixtureName,
  image: RawImageData,
  options: TraceOptions,
  paths: ReadonlyArray<ColoredPath>,
  ms: number,
): string {
  const polylines = paths.flatMap((path) => path.polylines);
  const closed = polylines.filter((pl) => pl.closed).length;
  const points = polylines.reduce((sum, pl) => sum + pl.points.length, 0);
  const parts = [
    `${name}: ${ms.toFixed(0)}ms polylines=${polylines.length} closed=${closed} ` +
      `open=${polylines.length - closed} points=${points}`,
  ];
  const isFilled = options.traceMode === undefined;
  if (name === 'arch') {
    if (isFilled) {
      const truth = inkMaskOf(preprocessForTrace(image, options));
      const metrics = compareMasks(rasterizeColoredPaths(paths, image.width, image.height), truth);
      parts.push(
        `  vectorization-IoU=${metrics.iou.toFixed(3)} precision=${metrics.precision.toFixed(3)} recall=${metrics.recall.toFixed(3)}`,
      );
    }
    parts.push(
      `  bandExcessTurnPer100Px=${measureBandExcessTurnPer100Px(polylines, LANGEBAAN_BAND).toFixed(2)}deg`,
    );
  }
  if (name === 'disc') {
    const longest = longestPolyline(polylines);
    if (longest !== null) {
      const rms = radialRms(longest, 90, 90);
      parts.push(`  discRadialRms=${rms.rms.toFixed(3)}px maxDev=${rms.maxDev.toFixed(3)}px`);
    }
  }
  if (name === 'star') {
    const err = cornerApexError(polylines);
    parts.push(`  starApexErr mean=${err.mean.toFixed(2)}px max=${err.max.toFixed(2)}px`);
  }
  return parts.join('\n');
}

// --- fixtures ---

function cropBand(image: RawImageData): RawImageData {
  const { x0, y0, x1, y1 } = LANGEBAAN_BAND;
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((y0 + y) * image.width + (x0 + x)) * 4;
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) data[dst + c] = image.data[src + c] ?? 255;
    }
  }
  return { width, height, data };
}

// 2x2 box downscale — emulates the soft rescaled sources users import.
function downscaleHalf(image: RawImageData): RawImageData {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const a = image.data[(y * 2 * image.width + x * 2) * 4 + c] ?? 255;
        const b = image.data[(y * 2 * image.width + x * 2 + 1) * 4 + c] ?? 255;
        const d = image.data[((y * 2 + 1) * image.width + x * 2) * 4 + c] ?? 255;
        const e = image.data[((y * 2 + 1) * image.width + x * 2 + 1) * 4 + c] ?? 255;
        data[(y * width + x) * 4 + c] = (a + b + d + e) / 4;
      }
    }
  }
  return { width, height, data };
}

function discImage(): RawImageData {
  const luma = paper(180, 180);
  inkDisc(luma, 90, 90, 60, 2);
  return toRawImage(luma);
}

function starCorners(): Vec2[] {
  const corners: Vec2[] = [];
  for (let k = 0; k < STAR_TIPS * 2; k += 1) {
    const angle = (k / (STAR_TIPS * 2)) * 2 * Math.PI;
    const radius = k % 2 === 0 ? STAR_OUTER_R : STAR_INNER_R;
    corners.push({
      x: STAR_CENTER + radius * Math.cos(angle),
      y: STAR_CENTER + radius * Math.sin(angle),
    });
  }
  return corners;
}

function starImage(): RawImageData {
  const size = 200;
  const corners = starCorners();
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, corners) ? 0 : 255;
      const o = (y * size + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

// --- metrics ---

function inkMaskOf(image: RawImageData): Mask {
  const data = new Uint8Array(image.width * image.height);
  for (let i = 0; i < data.length; i += 1) {
    const o = i * 4;
    const luma =
      0.299 * (image.data[o] ?? 255) +
      0.587 * (image.data[o + 1] ?? 255) +
      0.114 * (image.data[o + 2] ?? 255);
    data[i] = luma < INK_LUMA_MAX ? 1 : 0;
  }
  return { width: image.width, height: image.height, data };
}

function longestPolyline(polylines: ReadonlyArray<Polyline>): Polyline | null {
  let best: Polyline | null = null;
  let bestLength = 0;
  for (const polyline of polylines) {
    const length = arcLengthOf(polyline.points);
    if (length > bestLength) {
      bestLength = length;
      best = polyline;
    }
  }
  return best;
}

function radialRms(
  polyline: Polyline,
  cx: number,
  cy: number,
): { readonly rms: number; readonly maxDev: number } {
  const pts =
    polyline.closed && polyline.points[0] !== undefined
      ? [...polyline.points, polyline.points[0]]
      : [...polyline.points];
  const samples = sampleByArcLength(pts, 1);
  const radii = samples.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = radii.reduce((sum, r) => sum + r, 0) / Math.max(1, radii.length);
  const rms = Math.sqrt(
    radii.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / Math.max(1, radii.length),
  );
  const maxDev = radii.reduce((max, r) => Math.max(max, Math.abs(r - mean)), 0);
  return { rms, maxDev };
}

function cornerApexError(polylines: ReadonlyArray<Polyline>): {
  readonly mean: number;
  readonly max: number;
} {
  const sampled: Vec2[] = [];
  for (const polyline of polylines) {
    const pts =
      polyline.closed && polyline.points[0] !== undefined
        ? [...polyline.points, polyline.points[0]]
        : [...polyline.points];
    sampled.push(...sampleByArcLength(pts, 0.5));
  }
  if (sampled.length === 0) return { mean: Infinity, max: Infinity };
  let sum = 0;
  let max = 0;
  for (const corner of starCorners()) {
    let best = Infinity;
    for (const p of sampled) {
      best = Math.min(best, Math.hypot(p.x - corner.x, p.y - corner.y));
    }
    sum += best;
    max = Math.max(max, best);
  }
  return { mean: sum / (STAR_TIPS * 2), max };
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function arcLengthOf(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}
