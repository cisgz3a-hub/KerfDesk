// ADR-401: the commit traces the grid the placed output needs, not the 2048 px
// preview cap. The browser decode is stood in for by the app's own box-halving
// resampler, and the worker by the same tracer run inline.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { resampleBuffer } from '../../core/image-resample';
import {
  TRACE_PRESETS,
  boundsFromColoredPaths,
  traceImageToColoredPaths,
  type RawImageData,
} from '../../core/trace';
import type * as ImageLoaderModule from './image-loader';
import { loadImageAsRawData, readImageNaturalSize } from './image-loader';
import type * as WorkerClientModule from './use-trace-worker-client';
import { traceImageWithFallback } from './use-trace-worker-client';
import type * as RegionEnhanceModule from './region-enhance-trace';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { resolveTraceCommitResult } from './trace-commit-result';
import { scaleToCap } from './trace-decode-cap';

vi.mock('./image-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageLoaderModule>()),
  loadImageAsRawData: vi.fn(),
  readImageNaturalSize: vi.fn(),
}));
vi.mock('./region-enhance-trace', async (importOriginal) => {
  const original = await importOriginal<typeof RegionEnhanceModule>();
  return { ...original, traceImageWithBoundaryMode: vi.fn(original.traceImageWithBoundaryMode) };
});
vi.mock('./use-trace-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerClientModule>()),
  traceImageWithFallback: vi.fn(),
}));

const LINE_ART = TRACE_PRESETS['Line Art']!;
const FILE = new File([], 'source.png', { type: 'image/png' });

function blank(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(255);
}

function setLuma(data: Uint8ClampedArray, index: number, value: number): void {
  const offset = index * 4;
  const next = Math.min(data[offset] ?? 255, value);
  data[offset] = next;
  data[offset + 1] = next;
  data[offset + 2] = next;
}

// Four groups of ten vertical bars, anti-aliased by exact column coverage:
// 3 px bars with 1 px gaps, 0.7 px hairlines, 2 px bars with 2 px gaps, and
// 1.5 px bars with 1.5 px gaps. Group g starts at x = 200 + 1000 g.
const BAR_GROUPS: ReadonlyArray<readonly [width: number, gap: number]> = [
  [3, 1],
  [0.7, 15.3],
  [2, 2],
  [1.5, 1.5],
];

function barsFixture(): RawImageData {
  const width = 4096;
  const height = 512;
  const data = blank(width, height);
  BAR_GROUPS.forEach(([barWidth, gap], group) => {
    for (let bar = 0; bar < 10; bar += 1) {
      const x0 = 200 + 1000 * group + bar * (barWidth + gap);
      const x1 = x0 + barWidth;
      for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
        const coverage = Math.min(x + 1, x1) - Math.max(x, x0);
        for (let y = 56; y < 456; y += 1) {
          setLuma(data, y * width + x, Math.round(255 * (1 - coverage)));
        }
      }
    }
  });
  return { width, height, data };
}

// A disc of radius 900 px, anti-aliased by 4 x 4 supersampling.
function discFixture(): RawImageData {
  const width = 4096;
  const height = 2048;
  const data = blank(width, height);
  const [cx, cy, r] = [2048, 1024, 900];
  for (let y = cy - r - 2; y < cy + r + 2; y += 1) {
    for (let x = cx - r - 2; x < cx + r + 2; x += 1) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const dx = x + (sx + 0.5) / 4 - cx;
          const dy = y + (sy + 0.5) / 4 - cy;
          if (dx * dx + dy * dy <= r * r) inside += 1;
        }
      }
      setLuma(data, y * width + x, Math.round(255 * (1 - inside / 16)));
    }
  }
  return { width, height, data };
}

function serveSource(source: RawImageData): void {
  vi.mocked(readImageNaturalSize).mockResolvedValue({
    width: source.width,
    height: source.height,
  });
  vi.mocked(loadImageAsRawData).mockImplementation(async (_file, maxEdge = 2048) => {
    const grid = scaleToCap(source.width, source.height, maxEdge);
    return grid.width === source.width ? source : resampleBuffer(source, grid.width, grid.height);
  });
}

function commitGrid(widthMm: number, heightMm: number) {
  return { outputMm: { width: widthMm, height: heightMm }, targetPxPerMm: 20, deviceMemoryGb: 8 };
}

// Outer rings per bar group, in SOURCE pixels whatever grid was traced.
function ringsPerGroup(paths: ReadonlyArray<ColoredPath>, gridWidth: number): number[] {
  const counts = [0, 0, 0, 0];
  const toSource = 4096 / gridWidth;
  for (const polyline of paths.flatMap((path) => path.polylines)) {
    const x = (polyline.points[0]?.x ?? 0) * toSource;
    const group = Math.min(3, Math.floor(x / 1000));
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
}

function maxRadialDeviation(paths: ReadonlyArray<ColoredPath>, gridWidth: number): number {
  const toSource = 4096 / gridWidth;
  let worst = 0;
  for (const polyline of paths.flatMap((path) => path.polylines)) {
    for (const point of polyline.points) {
      const radius = Math.hypot(point.x * toSource - 2048, point.y * toSource - 1024);
      worst = Math.max(worst, Math.abs(radius - 900));
    }
  }
  return worst;
}

beforeEach(() => {
  vi.mocked(traceImageWithFallback).mockReset();
  vi.mocked(traceImageWithFallback).mockImplementation(async (image, options) => {
    const paths = await traceImageToColoredPaths(image, options);
    return {
      paths,
      bounds: boundsFromColoredPaths(paths),
      width: image.width,
      height: image.height,
    };
  });
  vi.mocked(loadImageAsRawData).mockReset();
  vi.mocked(readImageNaturalSize).mockReset();
  vi.mocked(traceImageWithBoundaryMode).mockClear();
});

describe('committed trace resolution (ADR-401)', () => {
  it('keeps every bar and hairline of a 4096 x 512 source that the preview grid loses', async () => {
    serveSource(barsFixture());
    // Before: the 2048 px cap fused the 3 px bars and erased the hairlines.
    const preview = await resolveTraceCommitResult({ file: FILE, options: LINE_ART });
    const previewRings = ringsPerGroup(preview.paths, preview.width);
    expect(preview.width).toBe(2048);
    expect(previewRings[0]).toBeLessThan(10);
    expect(previewRings[1]).toBe(0);

    const committed = await resolveTraceCommitResult({
      file: FILE,
      options: LINE_ART,
      commitGrid: commitGrid(409.6, 51.2),
    });
    expect(loadImageAsRawData).toHaveBeenLastCalledWith(FILE, 4096, undefined);
    expect({ width: committed.width, height: committed.height }).toEqual({
      width: 4096,
      height: 512,
    });
    expect(ringsPerGroup(committed.paths, committed.width)).toEqual([10, 10, 10, 10]);
  }, 60_000);

  it('traces a smooth R=900 disc closer to the true circle', async () => {
    serveSource(discFixture());
    const preview = await resolveTraceCommitResult({ file: FILE, options: LINE_ART });
    const committed = await resolveTraceCommitResult({
      file: FILE,
      options: LINE_ART,
      commitGrid: commitGrid(409.6, 204.8),
    });
    expect(committed.width).toBe(4096);
    const before = maxRadialDeviation(preview.paths, preview.width);
    const after = maxRadialDeviation(committed.paths, committed.width);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(0.5);
  }, 120_000);

  it('reuses the preview trace when the planned grid is the preview grid', async () => {
    vi.mocked(readImageNaturalSize).mockResolvedValue({ width: 800, height: 600 });
    const request = {
      file: FILE,
      options: LINE_ART,
      boundary: null,
      boundaryMode: 'crop' as const,
    };
    const result = {
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      width: 800,
      height: 600,
    };
    const resolved = await resolveTraceCommitResult({
      file: FILE,
      options: LINE_ART,
      preparedTrace: { request, result },
      commitGrid: commitGrid(80, 60),
    });
    expect(resolved).toBe(result);
    expect(loadImageAsRawData).not.toHaveBeenCalled();
  });

  it('reuses a trace an earlier commit settled at the finer grid, without decoding', async () => {
    serveSource(barsFixture());
    vi.mocked(loadImageAsRawData).mockClear();
    const request = {
      file: FILE,
      options: LINE_ART,
      boundary: null,
      boundaryMode: 'crop' as const,
    };
    const finer = {
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      width: 4096,
      height: 512,
    };
    const progress = vi.fn();
    const resolved = await resolveTraceCommitResult({
      file: FILE,
      options: LINE_ART,
      preparedTrace: { request, result: finer },
      commitGrid: commitGrid(409.6, 51.2),
      progress,
    });
    expect(resolved).toBe(finer);
    expect(loadImageAsRawData).not.toHaveBeenCalled();
    expect(traceImageWithFallback).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it.each(['crop', 'enhance'] as const)(
    'remaps a boundary drawn on the seed grid to the commit grid (%s mode)',
    async (boundaryMode) => {
      serveSource(barsFixture());
      // Drawn on a 2048 x 256 seed around the 2/2 px group (x 2000..3000 at 4096).
      const committed = await resolveTraceCommitResult({
        file: FILE,
        options: LINE_ART,
        boundary: { x: 1000, y: 0, width: 500, height: 256 },
        boundaryMode,
        sourceGrid: { width: 2048, height: 256 },
        commitGrid: commitGrid(409.6, 51.2),
      });
      expect(traceImageWithBoundaryMode).toHaveBeenCalledTimes(1);
      const call = vi.mocked(traceImageWithBoundaryMode).mock.calls[0]!;
      expect(call[0].width).toBe(4096);
      expect(call[2]).toEqual({ x: 2000, y: 0, width: 1000, height: 512 });
      expect(call[3]).toBe(boundaryMode);
      expect(committed.width).toBe(4096);
      const points = committed.paths.flatMap((path) => path.polylines.flatMap((p) => p.points));
      if (boundaryMode === 'crop') {
        expect(ringsPerGroup(committed.paths, committed.width)).toEqual([0, 0, 10, 0]);
        for (const point of points) {
          expect(point.x).toBeGreaterThanOrEqual(2000);
          expect(point.x).toBeLessThanOrEqual(3000);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(512);
        }
      } else {
        // Enhance keeps the full trace and re-traces only the remapped region.
        expect(ringsPerGroup(committed.paths, committed.width)).toEqual([10, 10, 10, 10]);
      }
    },
    120_000,
  );

  it('reports the finer decode and the trace phases while it works', async () => {
    serveSource(barsFixture());
    vi.mocked(traceImageWithFallback).mockImplementation(
      async (image, _options, _signal, progress) => {
        progress?.('preparing');
        progress?.('tracing');
        progress?.('refining');
        return {
          paths: [],
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          width: image.width,
          height: image.height,
        };
      },
    );
    const phases: string[] = [];
    await resolveTraceCommitResult({
      file: FILE,
      options: LINE_ART,
      commitGrid: commitGrid(409.6, 51.2),
      progress: (phase) => phases.push(phase),
    });
    expect(phases).toEqual(['decoding', 'preparing', 'tracing', 'refining']);
  });

  it('does not reuse a coarser preview trace when the output needs a finer grid', async () => {
    serveSource(barsFixture());
    const request = {
      file: FILE,
      options: LINE_ART,
      boundary: null,
      boundaryMode: 'crop' as const,
    };
    const coarse = {
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      width: 2048,
      height: 256,
    };
    const resolved = await resolveTraceCommitResult({
      file: FILE,
      options: LINE_ART,
      preparedTrace: { request, result: coarse },
      commitGrid: commitGrid(409.6, 51.2),
    });
    expect(resolved.width).toBe(4096);
  }, 60_000);

  it('falls back to the preview grid, and says so, when the finer decode fails', async () => {
    const source = barsFixture();
    serveSource(source);
    vi.mocked(loadImageAsRawData).mockImplementation(async (_file, maxEdge = 2048) => {
      if (maxEdge > 2048) throw new Error('Could not allocate canvas');
      return resampleBuffer(source, 2048, 256);
    });
    const resolved = await resolveTraceCommitResult({
      file: FILE,
      options: LINE_ART,
      commitGrid: commitGrid(409.6, 51.2),
    });
    expect(resolved.width).toBe(2048);
    expect(resolved.notices).toEqual(['preview-resolution']);
  }, 60_000);

  it('stops before decoding when the commit is cancelled while reading the size', async () => {
    const controller = new AbortController();
    vi.mocked(readImageNaturalSize).mockImplementation(async () => {
      controller.abort();
      return { width: 4096, height: 512 };
    });
    await expect(
      resolveTraceCommitResult({
        file: FILE,
        options: LINE_ART,
        commitGrid: commitGrid(409.6, 51.2),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadImageAsRawData).not.toHaveBeenCalled();
    expect(traceImageWithFallback).not.toHaveBeenCalled();
  });

  it('passes the cancel signal to the finer decode and trace, and does not fall back', async () => {
    serveSource(barsFixture());
    const controller = new AbortController();
    vi.mocked(traceImageWithFallback).mockImplementation(async (_image, _options, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException('Trace cancelled.', 'AbortError');
    });
    await expect(
      resolveTraceCommitResult({
        file: FILE,
        options: LINE_ART,
        commitGrid: commitGrid(409.6, 51.2),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
    expect(loadImageAsRawData).toHaveBeenCalledWith(FILE, 4096, controller.signal);
  });
});
