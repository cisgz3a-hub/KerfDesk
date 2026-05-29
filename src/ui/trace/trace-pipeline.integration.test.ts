// End-to-end integration test for the trace pipeline. Walks synthetic
// RawImageData through traceImageWithFallback — the same function the
// dialog's preview and commit both call — and asserts the resulting
// ColoredPath[] survives every stage: preprocessing, imagetracerjs,
// tracedata-to-ColoredPath conversion, H3 retry-on-zero-paths.
//
// What this test catches that the unit tests don't:
//   - Behaviour regressions where a pure function works in isolation
//     but the composition produces zero paths (the H3 symptom).
//   - Preset configurations that silently produce empty output.
//   - Worker-client fallback wrapping (this file runs under vitest,
//     so the Worker constructor fails and we get the inline path —
//     same code the production app uses when Worker is unavailable).
//
// What it doesn't catch (and intentionally so):
//   - The React render cycle (covered by structural memoisation in
//     ImportImageDialog).
//   - The actual Web Worker bundle (Vite-only behaviour).
//   - File-decode (loadImageAsRawData touches the DOM canvas API).

import { describe, expect, it } from 'vitest';

import type { RawImageData } from '../../core/trace';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageWithFallback } from './use-trace-worker-client';

const LINE_ART = TRACE_PRESETS['Line Art']!;
const DETAILED = TRACE_PRESETS['Detailed']!;

// Build a W×H white image with a filled black square inscribed at the
// given offset. Synthetic-but-realistic shape that imagetracerjs has
// no trouble with under any of the presets.
function whiteWithBlackSquare(
  width: number,
  height: number,
  squareX: number,
  squareY: number,
  squareSize: number,
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  // Fill with white.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  // Paint the black square.
  for (let y = squareY; y < squareY + squareSize; y += 1) {
    for (let x = squareX; x < squareX + squareSize; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const offset = (y * width + x) * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function pureWhiteImage(width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

describe('traceImageWithFallback — end-to-end pipeline', () => {
  it('traces a black-on-white square under Line Art (default preset)', async () => {
    const image = whiteWithBlackSquare(32, 32, 8, 8, 16);
    const { paths, bounds } = await traceImageWithFallback(image, LINE_ART);

    // At least one ColoredPath in the result.
    expect(paths.length).toBeGreaterThan(0);
    // The black square should be the only non-background colour.
    expect(paths[0]?.color).toBe('#000000');
    // Polylines should contain actual geometry, not stubs.
    const polylines = paths[0]?.polylines ?? [];
    expect(polylines.length).toBeGreaterThan(0);
    expect((polylines[0]?.points ?? []).length).toBeGreaterThanOrEqual(2);
    // Bounds should be finite and contained in the image.
    expect(Number.isFinite(bounds.minX)).toBe(true);
    expect(Number.isFinite(bounds.maxX)).toBe(true);
    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(32);
    expect(bounds.minY).toBeGreaterThanOrEqual(0);
    expect(bounds.maxY).toBeLessThanOrEqual(32);
    // Non-degenerate area.
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(0);
  });

  it('traces the same square under Detailed preset (multi-colour)', async () => {
    const image = whiteWithBlackSquare(32, 32, 8, 8, 16);
    const { paths } = await traceImageWithFallback(image, DETAILED);
    // Detailed does adaptive quantisation; at minimum the dark layer
    // should survive (background is dropped by the white-skip rule).
    expect(paths.length).toBeGreaterThan(0);
  });

  it('survives a pure-white image without crashing (returns 0 paths)', async () => {
    const image = pureWhiteImage(32, 32);
    const { paths, bounds } = await traceImageWithFallback(image, LINE_ART);
    // Nothing to trace, but the call must complete cleanly.
    expect(paths.length).toBe(0);
    // Empty bounds collapse to the origin — verified finite.
    expect(Number.isFinite(bounds.minX)).toBe(true);
    expect(Number.isFinite(bounds.maxY)).toBe(true);
  });

  it('rescues a small shape that pathOmit would otherwise drop on the first pass', async () => {
    // Line Art's pathOmit is 16; a small black square traces to
    // significantly fewer points and would be dropped on the first
    // pass. The H3 retry zeroes pathOmit, so the shape survives.
    // This is the "small logo / tiny glyph" case the user hits in
    // production — without it, the toast fires on inputs that
    // clearly have content.
    const image = whiteWithBlackSquare(32, 32, 12, 12, 8);
    const { paths } = await traceImageWithFallback(image, LINE_ART);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]?.color).toBe('#000000');
  });

  it('does not crash when the retry also produces zero paths', async () => {
    // The retry-on-empty path must terminate even when the relaxed
    // preset also fails (here: pure white, no content). The wrapper
    // returns the second result rather than looping or throwing.
    const image = pureWhiteImage(16, 16);
    const result = await traceImageWithFallback(image, LINE_ART);
    expect(result.paths).toEqual([]);
    expect(result.bounds).toBeDefined();
  });

  it('emits black paths for a larger black-on-white square (pathOmit-survivable)', async () => {
    // pathOmit defaults to 16 points per path. A 16x16 square gives
    // imagetracerjs enough perimeter to easily clear that bar — this
    // is the "normal user" case we want to be airtight.
    const image = whiteWithBlackSquare(64, 64, 16, 16, 32);
    const { paths } = await traceImageWithFallback(image, LINE_ART);
    expect(paths.length).toBeGreaterThan(0);
    // Every emitted ColoredPath should have at least one polyline
    // with at least 2 points — no degenerate output.
    for (const path of paths) {
      expect(path.polylines.length).toBeGreaterThan(0);
      for (const polyline of path.polylines) {
        expect(polyline.points.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
