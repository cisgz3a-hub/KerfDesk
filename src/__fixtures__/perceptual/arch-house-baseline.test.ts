// Real-image baseline: the user's actual Arch House logo (fixtures/arch-house.png).
// Synthetic strokes did not reproduce the reported timeout or letter-shatter, so
// this runs the REAL pixels through the current centerline tracer, times it, and
// renders the result for eyeballing (PERCEPTUAL_ARTIFACTS=1 dumps a
// [source ink | traced centerline | diff] PNG). This is the faithful bar the
// rework is measured against. Skips if the fixture is absent (CI without it).

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RawImageData } from '../../core/trace';
import { TRACE_PRESETS, traceImageToCenterlinePaths } from '../../core/trace';
import { decodePngFile } from './png-decode';
import { writePerceptualArtifact } from './png';
import { createMask, rasterizeColoredPaths, type Mask } from './rasterize';

const FIXTURE = 'fixtures/arch-house.png';
const CENTERLINE_OPTIONS = TRACE_PRESETS['Centerline']!;
const INK_LUMA = 128;

function sourceInkMask(image: RawImageData): Mask {
  const mask = createMask(image.width, image.height);
  for (let i = 0; i < image.width * image.height; i += 1) {
    const o = i * 4;
    const r = image.data[o] ?? 255;
    const g = image.data[o + 1] ?? 255;
    const b = image.data[o + 2] ?? 255;
    if (0.299 * r + 0.587 * g + 0.114 * b < INK_LUMA) mask.data[i] = 1;
  }
  return mask;
}

describe('arch-house real logo centerline baseline', () => {
  (existsSync(FIXTURE) ? it : it.skip)(
    'traces the real logo (timed + rendered for inspection)',
    () => {
      const image = decodePngFile(FIXTURE);
      const start = performance.now();
      const paths = traceImageToCenterlinePaths(image, CENTERLINE_OPTIONS);
      const elapsedMs = performance.now() - start;

      const polylines = paths.reduce((n, p) => n + p.polylines.length, 0);
      const points = paths.reduce(
        (n, p) => n + p.polylines.reduce((m, pl) => m + pl.points.length, 0),
        0,
      );
      console.log(
        `[arch-house] ${image.width}x${image.height} centerline: ${elapsedMs.toFixed(0)}ms, ` +
          `${polylines} polylines, ${points} points`,
      );

      const predicted = rasterizeColoredPaths(paths, image.width, image.height);
      const artifact = writePerceptualArtifact('arch-house-centerline', predicted, sourceInkMask(image));
      if (artifact !== null) console.log(`[arch-house] artifact: ${artifact}`);

      expect(image.width).toBe(1024);
    },
    { timeout: 120_000 },
  );
});
