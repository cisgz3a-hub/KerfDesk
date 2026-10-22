// ADR-409 Amendment 2 (audit 07-P2-2): a commit on a grid finer than the
// preview keeps the local detector windows at the size the preview used, so
// the committed trace keeps the ink the preview showed. The browser decode is
// stood in for by the app's own box-halving resampler, as in
// trace-commit-at-grid.test.ts.
import { describe, expect, it } from 'vitest';
import { resampleBuffer } from '../../core/image-resample';
import type { ColoredPath } from '../../core/scene';
import {
  TRACE_PRESETS,
  traceImageToColoredPaths,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import { planTraceCommitGrid, traceOptionsForCommitGrid } from './trace-commit-grid';
import { mergeLightBurnTraceSettings } from './trace-options';

const LINE_ART = TRACE_PRESETS['Line Art']!;

// A 3000 x 1200 scan placed at its import size (10 px/mm) against the 20 px/mm
// target: the commit traces the native grid, 1.46x the 2048 x 819 preview.
const PLAN = planTraceCommitGrid({
  native: { width: 3000, height: 1200 },
  outputMm: { width: 300, height: 120 },
  targetPxPerMm: 20,
  pixelBudget: 11_000_000,
});

/** Vertical strokes of the given widths (source px) down the page. */
function strokePage(widths: readonly number[], ink: number, paper: number): RawImageData {
  const { width, height } = PLAN.native;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([paper, paper, paper, 255], i * 4);
  const pitch = width / (widths.length + 1);
  widths.forEach((strokeWidth, index) => {
    const x0 = Math.round(pitch * (index + 1) - strokeWidth / 2);
    for (let y = 120; y < height - 120; y += 1)
      for (let x = x0; x < x0 + strokeWidth; x += 1)
        data.set([ink, ink, ink, 255], (y * width + x) * 4);
  });
  return { width, height, data };
}

/** Net traced area: outer rings and holes are wound in opposite senses. */
function tracedArea(paths: readonly ColoredPath[]): number {
  let twice = 0;
  for (const path of paths)
    for (const line of path.polylines)
      line.points.forEach((a, index) => {
        const b = line.points[(index + 1) % line.points.length]!;
        twice += a.x * b.y - b.x * a.y;
      });
  return Math.abs(twice / 2);
}

/** Committed ink over the preview's ink, both in source px². */
async function commitOverPreview(source: RawImageData, options: TraceOptions): Promise<number> {
  const { preview, grid } = PLAN;
  const small = resampleBuffer(source, preview.width, preview.height) as RawImageData;
  const previewArea =
    tracedArea(await traceImageToColoredPaths(small, options)) *
    (grid.width / preview.width) *
    (grid.height / preview.height);
  const commitArea = tracedArea(
    await traceImageToColoredPaths(source, traceOptionsForCommitGrid(options, PLAN)),
  );
  expect(previewArea).toBeGreaterThan(0);
  return commitArea / previewArea;
}

describe('a commit finer than the preview keeps the detector windows (ADR-409 Amd 2)', () => {
  it('plans the native grid at a fractional ratio over the preview', () => {
    expect(PLAN.grid).toEqual({ width: 3000, height: 1200 });
    expect(PLAN.preview).toEqual({ width: 2048, height: 819 });
    expect(traceOptionsForCommitGrid(LINE_ART, PLAN).detectorWindowScale).toBeCloseTo(3000 / 2048);
  });

  // Before: 0.66 at a 2x ratio; the 17 px box hollowed strokes wider than it.
  it('keeps the strokes Sketch detection filled in the preview', async () => {
    const sketch = mergeLightBurnTraceSettings(LINE_ART, { detectionMode: 'sketch' });
    const ratio = await commitOverPreview(strokePage([16, 20, 22], 40, 240), sketch);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  }, 120_000);

  // Before: 0.60 at a 2x ratio for pale broad marks.
  it("keeps Edge Detection's pale broad marks", async () => {
    const ratio = await commitOverPreview(
      strokePage([28, 34], 150, 255),
      TRACE_PRESETS['Edge Detection']!,
    );
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  }, 120_000);

  // Before: 0.32 at a 2x ratio; the 3 px thin-stroke test rejected the
  // commit's wider pixels. The preview's resample blur keeps it a little wider.
  it('keeps the pale pen lines Faint lines recovered in the preview', async () => {
    const faint = mergeLightBurnTraceSettings(LINE_ART, { detectionMode: 'faint-lines' });
    expect(await commitOverPreview(strokePage([2, 4], 170, 255), faint)).toBeGreaterThan(0.8);
  }, 120_000);
});
