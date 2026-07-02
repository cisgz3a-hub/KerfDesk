// Diagnostic zoom harness — renders cropped regions of the arch-house edge
// and centerline traces at high scale so letter-level defects are visible.
// Gated on TRACE_AUDIT=1; part of the standing perceptual eyeball toolkit.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { RawImageData } from '../../core/trace/trace-image';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { traceCenterlineStrokePaths } from '../../core/trace/centerline';
import { decodePngFile } from './png-decode';
import { renderTraceOverlay } from './render-overlay';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection'];

type Crop = { readonly name: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly scale: number };

const CROPS: ReadonlyArray<Crop> = [
  { name: 'zoom-langebaan', x: 300, y: 655, w: 440, h: 80, scale: 6 },
  { name: 'zoom-arch-letters', x: 130, y: 540, w: 400, h: 140, scale: 4 },
  { name: 'zoom-r-bowl', x: 215, y: 545, w: 120, h: 120, scale: 8 },
  { name: 'zoom-doorway', x: 430, y: 270, w: 165, h: 190, scale: 4 },
];

function cropImage(image: RawImageData, crop: Crop): RawImageData {
  const data = new Uint8ClampedArray(crop.w * crop.h * 4);
  for (let y = 0; y < crop.h; y += 1)
    for (let x = 0; x < crop.w; x += 1) {
      const src = ((crop.y + y) * image.width + (crop.x + x)) * 4;
      const dst = (y * crop.w + x) * 4;
      data[dst] = image.data[src] ?? 255;
      data[dst + 1] = image.data[src + 1] ?? 255;
      data[dst + 2] = image.data[src + 2] ?? 255;
      data[dst + 3] = 255;
    }
  return { width: crop.w, height: crop.h, data };
}

function cropPaths(paths: ReadonlyArray<ColoredPath>, crop: Crop): ColoredPath[] {
  return paths.map((path) => ({
    color: path.color,
    polylines: path.polylines
      .map((pl) => ({
        ...pl,
        points: pl.points.map((p) => ({ x: p.x - crop.x, y: p.y - crop.y })),
      }))
      .filter((pl) =>
        pl.points.some((p) => p.x >= -5 && p.y >= -5 && p.x <= crop.w + 5 && p.y <= crop.h + 5),
      ),
  }));
}

it('renders zoomed edge-trace crops of the arch-house logo', () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  if (EDGE_OPTIONS === undefined) throw new Error('missing preset');
  mkdirSync(OUT_DIR, { recursive: true });
  const image = decodePngFile('audit/fixtures/trace/arch-house-langebaan-source.png');
  const paths = traceImageToEdgePaths(image, EDGE_OPTIONS);
  for (const crop of CROPS) {
    const png = renderTraceOverlay(cropImage(image, crop), cropPaths(paths, crop), crop.scale);
    writeFileSync(join(OUT_DIR, `${crop.name}.png`), png);
  }
}, 120000);

it('renders zoomed CENTERLINE crops of the arch-house logo', () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  const centerlineOptions = TRACE_PRESETS['Centerline'];
  if (centerlineOptions === undefined) throw new Error('missing preset');
  mkdirSync(OUT_DIR, { recursive: true });
  const image = decodePngFile('audit/fixtures/trace/arch-house-langebaan-source.png');
  const started = performance.now();
  const paths = traceCenterlineStrokePaths(image, centerlineOptions);
  const elapsedMs = Math.round(performance.now() - started);
  writeFileSync(join(OUT_DIR, 'centerline-arch-timing.txt'), `${elapsedMs} ms\n`);
  writeFileSync(
    join(OUT_DIR, 'centerline-arch-full.png'),
    renderTraceOverlay(image, paths, 1),
  );
  for (const crop of CROPS) {
    const png = renderTraceOverlay(cropImage(image, crop), cropPaths(paths, crop), crop.scale);
    writeFileSync(join(OUT_DIR, `centerline-${crop.name}.png`), png);
  }
}, 240000);

it('renders raw Canny masks for the LANGEBAAN crop under preprocessing variants', () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  if (EDGE_OPTIONS === undefined) throw new Error('missing preset');
  mkdirSync(OUT_DIR, { recursive: true });
  const image = decodePngFile('audit/fixtures/trace/arch-house-langebaan-source.png');
  const crop = CROPS[0];
  if (crop === undefined) throw new Error('missing crop');
  const variants: ReadonlyArray<{ name: string; options: typeof EDGE_OPTIONS }> = [
    { name: 'mask-preset', options: EDGE_OPTIONS },
    { name: 'mask-no-median', options: { ...EDGE_OPTIONS, edgeMedianFilter: false } },
    {
      name: 'mask-no-median-blur08',
      options: { ...EDGE_OPTIONS, edgeMedianFilter: false, edgeBlurSigma: 0.8 },
    },
  ];
  for (const variant of variants) {
    const traced = traceImageToEdgePaths(image, variant.options);
    const png = renderTraceOverlay(cropImage(image, crop), cropPaths(traced, crop), crop.scale);
    writeFileSync(join(OUT_DIR, `${variant.name}.png`), png);
  }
}, 180000);
