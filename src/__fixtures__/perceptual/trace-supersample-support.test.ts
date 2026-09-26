import { afterEach, describe, expect, it, vi } from 'vitest';
import { upscaleBy } from '../../core/trace/auto-upscale';
import { prepareContourTraceInput, type ContourTraceInput } from '../../core/trace/contour-input';
import { restoreEnlargedContourSupport } from '../../core/trace/contour-support';
import * as contourTrace from '../../core/trace/contour-trace';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import { decodePngFile } from './png-decode';

const fixture = 'src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png';

afterEach(() => vi.restoreAllMocks());

describe('real Arch House supersampling with local support recovery', () => {
  it.each(['Line Art', 'Smooth'])(
    'keeps %s bilinear measurements outside erased detail',
    (name) => {
      const source = decodePngFile(fixture);
      const options = TRACE_PRESETS[name]!;
      const native = prepareContourTraceInput(source, options);
      const enlarged = prepareContourTraceInput(upscaleBy(source, 2), {
        ...options,
        pixelScale: 2,
      });
      const restored = restoreEnlargedContourSupport(native, enlarged, 2);
      expect(restored.prepared.width).toBe(2048);
      expect(restored.prepared.height).toBe(2048);
      const { changed, measured } = supportMetrics(enlarged, restored);
      expect(changed).toBeGreaterThan(0);
      // Base 84 / 249; ADR-403 measures 120 / 305. The enlarged mask now
      // resolves corners from source-pixel evidence, including Smooth ties whose
      // bilinear saddle value is the symmetric 127.5 against a cut of 128
      // (not evidence, so paper joins), which native support restores.
      expect(changed).toBeLessThan(320);
      expect(measured).toBeGreaterThan(100_000);
      assertUnchangedApex(enlarged, restored);
    },
    60_000,
  );

  it('dispatches the real Line Art trace on the enlarged grid after recovering detail', async () => {
    const source = decodePngFile(fixture);
    const backend = vi.spyOn(contourTrace, 'traceImageToContourColoredPathsSteps');
    const paths = await traceImageToColoredPaths(source, TRACE_PRESETS['Line Art']!);
    expect(backend).toHaveBeenCalledTimes(1);
    expect(backend.mock.calls[0]?.[0].width).toBe(2048);
    expect(backend.mock.calls[0]?.[1].pixelScale).toBe(2);
    expect(paths.flatMap((path) => path.polylines).length).toBeGreaterThan(10);
    expect(paths.every((path) => path.polylines.every((line) => line.closed))).toBe(true);
  }, 120_000);
});

function supportMetrics(enlarged: ContourTraceInput, restored: ContourTraceInput) {
  let changed = 0;
  let measured = 0;
  for (let y = 0; y < enlarged.prepared.height; y += 1) {
    for (let x = 0; x < enlarged.prepared.width; x += 1) {
      const offset = (y * enlarged.prepared.width + x) * 4;
      if (restored.prepared.data[offset] !== enlarged.prepared.data[offset]) changed += 1;
      const luma = enlarged.crackField?.lumaAt(x, y) ?? 0;
      if (luma > 0 && luma < 255 && sameScalarAt(enlarged, restored, x, y)) measured += 1;
    }
  }
  return { changed, measured };
}

function sameScalarAt(a: ContourTraceInput, b: ContourTraceInput, x: number, y: number): boolean {
  return (
    a.crackField?.lumaAt(x, y) === b.crackField?.lumaAt(x, y) &&
    a.crackField?.thresholdAt(x, y) === b.crackField?.thresholdAt(x, y)
  );
}

function assertUnchangedApex(enlarged: ContourTraceInput, restored: ContourTraceInput): void {
  // The measured apex benefits from supersampling and is far from the
  // erased interior strokes. Its working mask and scalar ramp are intact.
  for (let y = 500; y < 580; y += 1) {
    for (let x = 1120; x < 1160; x += 1) {
      const offset = (y * 2048 + x) * 4;
      expect(restored.prepared.data[offset]).toBe(enlarged.prepared.data[offset]);
      expect(sameScalarAt(enlarged, restored, x, y)).toBe(true);
    }
  }
}
