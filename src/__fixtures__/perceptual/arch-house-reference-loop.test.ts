// arch-house-reference-loop — dev-loop scorer for the Arch House logo trace.
// Traces the real source logo and enforces fidelity to each preset's processed
// source mask. The separately authored outline/filled drawings remain useful
// visual direction, but they change geometry and typography and therefore are
// diagnostic comparisons, not pixel-registered acceptance truth.
//
// Render optional review artifacts with:
//   PERCEPTUAL_ARTIFACTS=1 npx vitest run \
//     src/__fixtures__/perceptual/arch-house-reference-loop.test.ts
//
// Artifacts land in perceptual-artifacts/ (gitignored):
//   arch-loop-<preset>-fill.png    [filled ref | traced fill | diff]
//   arch-loop-<preset>-stroke.png  [outline ref | traced strokes | diff]
//   arch-loop-<preset>-overlay.png traced paths over the faint source
//
// Chamfer metrics quantify "identical corners and lines": distance from every
// traced stroke pixel to the nearest reference ink pixel (spurious/deviating
// lines) and the reverse (missed lines).

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths, type RawImageData } from '../../core/trace';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { chamferDistance } from './chamfer';
import { compareMasks } from './compare';
import { decodePngFile } from './png-decode';
import { encodeRgbPng, writePerceptualArtifact } from './png';
import { rasterizeColoredPaths, createMask, type Mask } from './rasterize';
import { renderTraceOverlay } from './render-overlay';

const ASSETS_DIR = join(process.cwd(), 'src', '__fixtures__', 'perceptual', 'assets');
const SOURCE_PATH = join(ASSETS_DIR, 'arch-house-langebaan-source.png');
const OUTLINE_REF_PATH = join(ASSETS_DIR, 'arch-house-outline-reference.png');
const FILLED_REF_PATH = join(ASSETS_DIR, 'arch-house-filled-reference.png');
const ARTIFACT_DIR = 'perceptual-artifacts';

const INK_LUMA_MAX = 128;
const PRESETS_UNDER_TEST = ['Line Art', 'Smooth', 'Sharp', 'Edge Detection'] as const;
const MIN_INPUT_IOU: Readonly<Record<(typeof PRESETS_UNDER_TEST)[number], number>> = {
  'Line Art': 0.94,
  Smooth: 0.95,
  Sharp: 0.97,
  'Edge Detection': 0.8,
};

describe('arch-house real-source trace fidelity', () => {
  it(
    'enforces input fidelity and reports the diagnostic reference pair',
    { timeout: 600_000 },
    async () => {
      const source = decodePngFile(SOURCE_PATH);
      const outlineRef = inkMaskFromImage(decodePngFile(OUTLINE_REF_PATH));
      const filledRef = inkMaskFromImage(decodePngFile(FILLED_REF_PATH));
      const scale = filledRef.width / source.width;

      // Upper bound context: the references were generated separately from the
      // source, so first measure how well the source's OWN ink aligns with the
      // filled reference. No tracer can beat this ceiling on ref-vs-trace IoU.
      const lineArt = TRACE_PRESETS['Line Art']!;
      const engineTruth = monoToMask(preprocessForTrace(source, lineArt));
      const truthScaled = scaleMaskNearest(engineTruth, filledRef.width, filledRef.height);
      const alignment = compareMasks(truthScaled, filledRef);
      console.log(
        `[align] source-ink vs filled-ref: IoU=${alignment.iou.toFixed(3)} ` +
          `precision=${alignment.precision.toFixed(3)} recall=${alignment.recall.toFixed(3)} ` +
          `(ceiling for any tracer scored against the refs)`,
      );

      const outlineDt = chamferDistance(outlineRef);

      for (const presetName of PRESETS_UNDER_TEST) {
        const preset = TRACE_PRESETS[presetName];
        if (preset === undefined) continue;
        const start = performance.now();
        const paths = await traceImageToColoredPaths(source, preset);
        const elapsedMs = performance.now() - start;

        // Fidelity to the input (this preset's own binarized truth).
        const presetTruth = monoToMask(preprocessForTrace(source, preset));
        const fillMask = rasterizeColoredPaths(paths, source.width, source.height);
        const inputFidelity = compareMasks(fillMask, presetTruth);

        // Fidelity to the maintainer's filled reference.
        const fillScaled = scaleMaskNearest(fillMask, filledRef.width, filledRef.height);
        const refFidelity = compareMasks(fillScaled, filledRef);

        // Stroke rendering vs the outline reference (the acceptance overlay).
        const strokeMask = strokeRasterize(paths, scale, outlineRef.width, outlineRef.height);
        const strokeToRef = distanceStats(strokeMask, outlineDt);
        const refToStroke = distanceStats(outlineRef, chamferDistance(strokeMask));

        console.log(
          `[${presetName}] ${elapsedMs.toFixed(0)}ms ` +
            `inputIoU=${inputFidelity.iou.toFixed(3)} refIoU=${refFidelity.iou.toFixed(3)} | ` +
            `stroke->ref px mean=${strokeToRef.mean.toFixed(2)} p95=${strokeToRef.p95.toFixed(1)} ` +
            `max=${strokeToRef.max.toFixed(1)} | ref->stroke mean=${refToStroke.mean.toFixed(2)} ` +
            `p95=${refToStroke.p95.toFixed(1)} max=${refToStroke.max.toFixed(1)}`,
        );

        const slug = presetName.toLowerCase().replace(/\s+/g, '-');
        writePerceptualArtifact(`arch-loop-${slug}-fill`, fillScaled, filledRef);
        writePerceptualArtifact(`arch-loop-${slug}-stroke`, strokeMask, outlineRef);
        writeOverlayArtifact(`arch-loop-${slug}-overlay`, source, paths);

        // Zoomed defect crops: serif melt, corner rounding, and wobble are
        // invisible at full scale; these are the images the loop is judged on.
        const strokeSourceFrame = strokeRasterize(paths, 1, source.width, source.height);
        for (const region of CROP_REGIONS) {
          writeRegionCropArtifact(
            `arch-loop-${slug}-crop-${region.name}`,
            region,
            source,
            presetTruth,
            fillMask,
            strokeSourceFrame,
          );
        }

        // VECTOR-resolution crops: rasterize the traced paths at CROP_ZOOM×
        // scale (what the canvas shows when zoomed) — sub-pixel spikes and
        // scallops that vanish at 1024 rasterization are visible here.
        const scaledPaths = scalePaths(paths, CROP_ZOOM);
        const hiFill = rasterizeColoredPaths(
          scaledPaths,
          source.width * CROP_ZOOM,
          source.height * CROP_ZOOM,
        );
        const hiStroke = strokeRasterize(
          paths,
          CROP_ZOOM,
          source.width * CROP_ZOOM,
          source.height * CROP_ZOOM,
        );
        for (const region of CROP_REGIONS) {
          writeVectorCropArtifact(`arch-loop-${slug}-vec-${region.name}`, region, hiFill, hiStroke);
        }

        expect(paths.length).toBeGreaterThan(0);
        expect(inputFidelity.iou, `${presetName} input-mask IoU`).toBeGreaterThanOrEqual(
          MIN_INPUT_IOU[presetName],
        );
        expect(Number.isFinite(strokeToRef.mean)).toBe(true);
      }
    },
  );
});

// Regions of interest in SOURCE pixel coordinates (1024²), chosen from the
// maintainer's defect reports: letterforms (serif corners), the arch curve,
// long straight roof lines, and the busy water texture inside the arch.
type CropRegion = {
  readonly name: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

const CROP_REGIONS: ReadonlyArray<CropRegion> = [
  // Upper roof beam (iteration-12 verdict: renders hollow on the canvas).
  { name: 'top-beam', x0: 285, y0: 230, x1: 585, y1: 320 },
  // Tight H-stem close-up (iteration-8 verdict: chord-joint steps on stems).
  { name: 'h-stem', x0: 515, y0: 540, x1: 585, y1: 670 },
  { name: 'arch-word', x0: 120, y0: 540, x1: 520, y1: 665 },
  { name: 'house-word', x0: 520, y0: 540, x1: 910, y1: 665 },
  { name: 'langebaan', x0: 290, y0: 660, x1: 740, y1: 730 },
  { name: 'arch-top', x0: 370, y0: 185, x1: 660, y1: 340 },
  { name: 'roof-left', x0: 150, y0: 295, x1: 400, y1: 435 },
  // Birds + sun + upper water: hosts the small enclosed whites the pinhole
  // audit found at (426,341)/(600,336) — collateral watch for the fill.
  { name: 'sun-birds', x0: 400, y0: 280, x1: 640, y1: 470 },
  // Long organic wave curves: where the maintainer reported Sharp's
  // scalloped/uneven edges.
  { name: 'waves', x0: 100, y0: 430, x1: 470, y1: 545 },
  // Tight close-ups for the iteration-5 verdict ("still some uneven spots
  // and sharp points"): the A's hooked apex and the ARCH serif feet.
  { name: 'a-apex', x0: 125, y0: 540, x1: 245, y1: 615 },
  { name: 'serif-feet', x0: 120, y0: 620, x1: 330, y1: 668 },
];

const CROP_ZOOM = 3;

// One artifact per region: four stacked panels (source | binarized truth |
// traced fill | traced strokes), nearest-neighbour upscaled so 1px defects
// read clearly. Truth vs fill separates binarization defects from tracing
// defects — a crack present in truth is a preprocessing bug, one that only
// appears in fill is a contour-fitting bug.
function writeRegionCropArtifact(
  name: string,
  region: CropRegion,
  source: RawImageData,
  truthMask: Mask,
  fillMask: Mask,
  strokeMask: Mask,
): void {
  if (process.env['PERCEPTUAL_ARTIFACTS'] !== '1') return;
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  const panelW = w * CROP_ZOOM;
  const panelH = h * CROP_ZOOM;
  const gap = 4;
  const panels = 4;
  const totalH = panelH * panels + gap * (panels - 1);
  const rgb = new Uint8Array(panelW * totalH * 3).fill(255);
  paintSourcePanel(rgb, panelW, region, source);
  paintMaskPanel(rgb, panelW, panelH + gap, region, truthMask);
  paintMaskPanel(rgb, panelW, 2 * (panelH + gap), region, fillMask);
  paintMaskPanel(rgb, panelW, 3 * (panelH + gap), region, strokeMask);
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, `${name}.png`), encodeRgbPng(rgb, panelW, totalH));
}

// Vector-resolution crop: two panels [fill | strokes] sampled DIRECTLY from
// CROP_ZOOM×-rasterized masks of the traced paths — the canvas-at-zoom view.
function writeVectorCropArtifact(
  name: string,
  region: CropRegion,
  hiFill: Mask,
  hiStroke: Mask,
): void {
  if (process.env['PERCEPTUAL_ARTIFACTS'] !== '1') return;
  const panelW = (region.x1 - region.x0) * CROP_ZOOM;
  const panelH = (region.y1 - region.y0) * CROP_ZOOM;
  const gap = 4;
  const totalH = panelH * 2 + gap;
  const rgb = new Uint8Array(panelW * totalH * 3).fill(255);
  paintHiMaskPanel(rgb, panelW, 0, region, hiFill);
  paintHiMaskPanel(rgb, panelW, panelH + gap, region, hiStroke);
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, `${name}.png`), encodeRgbPng(rgb, panelW, totalH));
}

// Unlike paintMaskPanel (nearest-upscale from source-res masks), this samples
// a mask already rasterized at CROP_ZOOM× — one mask pixel per crop pixel.
function paintHiMaskPanel(
  rgb: Uint8Array,
  panelW: number,
  offsetY: number,
  region: CropRegion,
  hiMask: Mask,
): void {
  const panelH = (region.y1 - region.y0) * CROP_ZOOM;
  for (let y = 0; y < panelH; y += 1) {
    for (let x = 0; x < panelW; x += 1) {
      const sx = region.x0 * CROP_ZOOM + x;
      const sy = region.y0 * CROP_ZOOM + y;
      if ((hiMask.data[sy * hiMask.width + sx] ?? 0) === 1) {
        setRgb(rgb, panelW, x, offsetY + y, [0, 0, 0]);
      }
    }
  }
}

function scalePaths(paths: ReadonlyArray<ColoredPath>, scale: number): ColoredPath[] {
  return paths.map((path) => ({
    color: path.color,
    polylines: path.polylines.map((polyline) => ({
      closed: polyline.closed,
      points: polyline.points.map((point) => ({ x: point.x * scale, y: point.y * scale })),
    })),
  }));
}

function paintSourcePanel(
  rgb: Uint8Array,
  panelW: number,
  region: CropRegion,
  source: RawImageData,
): void {
  const panelH = (region.y1 - region.y0) * CROP_ZOOM;
  for (let y = 0; y < panelH; y += 1) {
    for (let x = 0; x < panelW; x += 1) {
      const sx = region.x0 + Math.floor(x / CROP_ZOOM);
      const sy = region.y0 + Math.floor(y / CROP_ZOOM);
      const src = (sy * source.width + sx) * 4;
      setRgb(rgb, panelW, x, y, [
        source.data[src] ?? 255,
        source.data[src + 1] ?? 255,
        source.data[src + 2] ?? 255,
      ]);
    }
  }
}

function paintMaskPanel(
  rgb: Uint8Array,
  panelW: number,
  offsetY: number,
  region: CropRegion,
  mask: Mask,
): void {
  const panelH = (region.y1 - region.y0) * CROP_ZOOM;
  for (let y = 0; y < panelH; y += 1) {
    for (let x = 0; x < panelW; x += 1) {
      const sx = region.x0 + Math.floor(x / CROP_ZOOM);
      const sy = region.y0 + Math.floor(y / CROP_ZOOM);
      if ((mask.data[sy * mask.width + sx] ?? 0) === 1) {
        setRgb(rgb, panelW, x, offsetY + y, [0, 0, 0]);
      }
    }
  }
}

function setRgb(
  rgb: Uint8Array,
  width: number,
  x: number,
  y: number,
  color: readonly [number, number, number],
): void {
  const base = (y * width + x) * 3;
  rgb[base] = color[0];
  rgb[base + 1] = color[1];
  rgb[base + 2] = color[2];
}

// Luma-threshold ink mask for the black-on-white reference drawings.
function inkMaskFromImage(image: RawImageData): Mask {
  const mask = createMask(image.width, image.height);
  for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
    const r = image.data[pixel * 4] ?? 255;
    const g = image.data[pixel * 4 + 1] ?? 255;
    const b = image.data[pixel * 4 + 2] ?? 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    mask.data[pixel] = luma < INK_LUMA_MAX ? 1 : 0;
  }
  return mask;
}

// preprocessForTrace returns a monochrome RGBA image; channel 0 is the luma.
function monoToMask(image: RawImageData): Mask {
  const mask = createMask(image.width, image.height);
  for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
    mask.data[pixel] = (image.data[pixel * 4] ?? 255) < INK_LUMA_MAX ? 1 : 0;
  }
  return mask;
}

function scaleMaskNearest(mask: Mask, width: number, height: number): Mask {
  const out = createMask(width, height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(mask.width - 1, Math.floor((x * mask.width) / width));
      out.data[y * width + x] = mask.data[sy * mask.width + sx] ?? 0;
    }
  }
  return out;
}

// Rasterize every polyline edge (including the closing edge) as 1px strokes,
// scaled into the reference frame. This is "the trace as outlines" — what the
// maintainer overlays on the outline reference.
function strokeRasterize(
  paths: ReadonlyArray<ColoredPath>,
  scale: number,
  width: number,
  height: number,
): Mask {
  const mask = createMask(width, height);
  for (const path of paths) {
    for (const polyline of path.polylines) {
      const points = polyline.points;
      const edgeCount = polyline.closed ? points.length : points.length - 1;
      for (let i = 0; i < edgeCount; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (a === undefined || b === undefined) continue;
        drawLine(mask, a.x * scale, a.y * scale, b.x * scale, b.y * scale);
      }
    }
  }
  return mask;
}

function drawLine(mask: Mask, ax: number, ay: number, bx: number, by: number): void {
  if (![ax, ay, bx, by].every(Number.isFinite)) return;
  let x0 = Math.round(ax);
  let y0 = Math.round(ay);
  const x1 = Math.round(bx);
  const y1 = Math.round(by);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const guardMax = 4 * (mask.width + mask.height);
  for (let guard = 0; guard < guardMax; guard += 1) {
    plotPixel(mask, x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function plotPixel(mask: Mask, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
  mask.data[y * mask.width + x] = 1;
}

const P95 = 0.95;

// Distance stats for every ink pixel of `mask` sampled against a chamfer
// field. mean/p95/max of "how far is each of our line pixels from the
// reference's nearest line pixel".
function distanceStats(mask: Mask, dt: Float32Array): { mean: number; p95: number; max: number } {
  const samples: number[] = [];
  for (let i = 0; i < mask.data.length; i += 1) {
    if ((mask.data[i] ?? 0) === 1) samples.push(dt[i] ?? 0);
  }
  if (samples.length === 0) return { mean: Number.NaN, p95: Number.NaN, max: Number.NaN };
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * P95))] ?? 0;
  const max = samples[samples.length - 1] ?? 0;
  return { mean, p95, max };
}

function writeOverlayArtifact(
  name: string,
  source: RawImageData,
  paths: ReadonlyArray<ColoredPath>,
): void {
  if (process.env['PERCEPTUAL_ARTIFACTS'] !== '1') return;
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, `${name}.png`), renderTraceOverlay(source, paths, 1));
}

// Referenced so a missing asset fails loudly at collection time when the loop
// is enabled, instead of a confusing decode error mid-test.
for (const path of [SOURCE_PATH, OUTLINE_REF_PATH, FILLED_REF_PATH]) {
  if (!existsSync(path)) throw new Error(`arch-house loop asset missing: ${path}`);
}
