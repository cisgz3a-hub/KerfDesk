import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../scene';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';
import { traceImagesToSvgFiles } from './batch-trace';

const SQUARE_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
    },
  ],
};

function rawImage(width: number, height: number): RawImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

describe('traceImagesToSvgFiles', () => {
  it('traces each image to a standalone SVG file without requiring scene mutation', async () => {
    const trace = vi.fn(async () => [SQUARE_PATH]);

    const files = await traceImagesToSvgFiles(
      [
        { sourceName: 'logo.png', image: rawImage(4, 3) },
        { sourceName: 'photo.jpg', image: rawImage(6, 5) },
      ],
      { trace },
    );

    expect(files.map((file) => file.filename)).toEqual(['logo-trace.svg', 'photo-trace.svg']);
    expect(files.map((file) => file.pathCount)).toEqual([1, 1]);
    expect(files[0]?.svg).toContain('viewBox="0 0 4 3"');
    expect(files[0]?.svg).toContain('<path d="M0 0 L2 0 L2 2 L0 2 Z"');
    expect(trace).toHaveBeenNthCalledWith(1, rawImage(4, 3), DEFAULT_TRACE_OPTIONS);
    expect(trace).toHaveBeenNthCalledWith(2, rawImage(6, 5), DEFAULT_TRACE_OPTIONS);
  });

  it('uses per-image trace options and unique safe filenames', async () => {
    const customOptions: TraceOptions = {
      ...DEFAULT_TRACE_OPTIONS,
      cutoffLuma: 200,
    };
    const trace = vi.fn(async () => []);

    const files = await traceImagesToSvgFiles(
      [
        { sourceName: 'brand/logo.png', image: rawImage(1, 1), options: customOptions },
        { sourceName: 'brand\\logo.png', image: rawImage(2, 2) },
        { sourceName: 'bad<name>?.png', image: rawImage(3, 3) },
      ],
      { trace },
    );

    expect(files.map((file) => file.filename)).toEqual([
      'logo-trace.svg',
      'logo-2-trace.svg',
      'bad-name---trace.svg',
    ]);
    expect(files.map((file) => file.svg)).toEqual([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 3" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"></svg>',
    ]);
    expect(trace).toHaveBeenNthCalledWith(1, rawImage(1, 1), customOptions);
    expect(trace).toHaveBeenNthCalledWith(2, rawImage(2, 2), DEFAULT_TRACE_OPTIONS);
  });

  it('writes physical dimensions into standalone SVG exports when provided', async () => {
    const trace = vi.fn(async () => [SQUARE_PATH]);

    const files = await traceImagesToSvgFiles(
      [
        {
          sourceName: 'wide-logo.png',
          image: rawImage(1000, 500),
          physicalSizeMm: { widthMm: 100, heightMm: 50 },
        },
      ],
      { trace },
    );

    expect(files[0]?.svg).toContain('viewBox="0 0 1000 500"');
    expect(files[0]?.svg).toContain('width="100mm"');
    expect(files[0]?.svg).toContain('height="50mm"');
  });
});
