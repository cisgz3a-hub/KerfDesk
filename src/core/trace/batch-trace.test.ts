import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath, Polyline } from '../scene';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';
import { traceImagesToVectorFiles } from './batch-trace';

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

const ZERO_AREA_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
    },
  ],
};

const BACKGROUND_PATH: ColoredPath = {
  color: '#ffffff',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    },
  ],
};

const CURVED_PATH: ColoredPath = {
  color: '#000000',
  // A stale dense compatibility polyline: the exporter must write `curves`.
  polylines: [
    {
      closed: true,
      points: Array.from({ length: 64 }, (_, i) => ({
        x: 2 + Math.cos((i / 64) * 2 * Math.PI),
        y: 2 + Math.sin((i / 64) * 2 * Math.PI),
      })),
    },
  ],
  curves: [
    {
      start: { x: 1, y: 2 },
      closed: true,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 1, y: 1.4 },
          control2: { x: 1.4, y: 1 },
          to: { x: 2, y: 1 },
        },
        { kind: 'line', to: { x: 3, y: 1 } },
        { kind: 'line', to: { x: 3, y: 3 } },
        { kind: 'line', to: { x: 1, y: 3 } },
        { kind: 'line', to: { x: 1, y: 2 } },
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

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

describe('traceImagesToVectorFiles', () => {
  it('carries explicit Centerline intent into SVG paint and visible path counts', async () => {
    const zeroAreaStroke: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 1, y: 1 },
            { x: 3, y: 3 },
          ],
        },
      ],
    };
    const trace = vi.fn(async () => [zeroAreaStroke]);
    const options: TraceOptions = { ...DEFAULT_TRACE_OPTIONS, traceMode: 'centerline' };
    const result = await traceImagesToVectorFiles(
      [
        {
          sourceName: 'ring.png',
          image: rawImage(8, 8),
          options,
          physicalSizeMm: { widthMm: 16, heightMm: 8 },
        },
        { sourceName: 'ring.jpg', image: rawImage(8, 8) },
      ],
      { trace },
    );
    // Filled-contour intent: a zero-area closed ring is not visible ink.
    expect(result.files.map((f) => f.filename)).toEqual(['ring-trace.svg']);
    expect(result.skipped).toEqual([{ sourceName: 'ring.jpg', reason: 'no-visible-paths' }]);
    expect(result.files[0]?.pathCount).toBe(1);
    // 1 px = 2 mm across and 1 mm down; the stroke is one source pixel wide.
    expect(result.files[0]?.text).toContain(
      'd="M2 1l4 2z" fill="none" stroke="#000000" stroke-width="2"',
    );
    expect(result.files[0]?.text).toContain('viewBox="0 0 16 8" width="16mm" height="8mm"');
    expect(trace).toHaveBeenNthCalledWith(1, rawImage(8, 8), options);
  });

  it('writes the canonical curves in millimetres instead of the dense polylines', async () => {
    const result = await traceImagesToVectorFiles(
      [
        {
          sourceName: 'logo.png',
          image: rawImage(4, 4),
          physicalSizeMm: { widthMm: 40, heightMm: 40 },
        },
      ],
      { trace: async () => [CURVED_PATH] },
    );
    expect(result.files[0]?.text).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40mm" height="40mm"' +
        ' preserveAspectRatio="xMidYMid meet">' +
        '<path d="M10 20c0-6 4-10 10-10h10v20h-20z" fill="#000000" fill-rule="evenodd" stroke="none"/>' +
        '</svg>',
    );
  });

  it('rounds coordinates to the requested precision in millimetres', async () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0.123456, y: 0.2 },
            { x: 1.987654, y: 0.2 },
            { x: 1.5, y: 1.333333 },
          ],
        },
      ],
    };
    const run = async (precisionMm: number): Promise<string> =>
      (
        await traceImagesToVectorFiles(
          [
            {
              sourceName: 'a.png',
              image: rawImage(2, 2),
              physicalSizeMm: { widthMm: 2, heightMm: 2 },
            },
          ],
          { trace: async () => [path] },
          { precisionMm },
        )
      ).files[0]?.text ?? '';
    expect(await run(0.001)).toContain('d="M.123 .2h1.865l-.488 1.133z"');
    expect(await run(0.1)).toContain('d="M.1 .2h1.9l-.5 1.1z"');
  });

  it('groups each outer contour with its own holes when asked', async () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [square(0, 0, 10), square(2, 2, 3), square(20, 0, 5), square(6, 6, 2)],
    };
    const result = await traceImagesToVectorFiles(
      [
        {
          sourceName: 'a.png',
          image: rawImage(30, 10),
          physicalSizeMm: { widthMm: 30, heightMm: 10 },
        },
      ],
      { trace: async () => [path] },
      { groupContours: true },
    );
    const groups = (result.files[0]?.text ?? '').match(/<g><path d="[^"]*"/g) ?? [];
    expect(groups).toEqual([
      '<g><path d="M0 0h10v10h-10zm2 2h3v3h-3zm4 4h2v2h-2z"',
      '<g><path d="M20 0h5v5h-5z"',
    ]);
  });

  it('uses per-image trace options and unique safe filenames', async () => {
    const customOptions: TraceOptions = {
      ...DEFAULT_TRACE_OPTIONS,
      cutoffLuma: 200,
    };
    const trace = vi.fn(async () => [SQUARE_PATH]);

    const result = await traceImagesToVectorFiles(
      [
        { sourceName: 'brand/logo.png', image: rawImage(1, 1), options: customOptions },
        { sourceName: 'brand\\logo.png', image: rawImage(2, 2) },
        { sourceName: 'bad<name>?.png', image: rawImage(3, 3) },
      ],
      { trace },
    );

    expect(result.files.map((file) => file.filename)).toEqual([
      'logo-trace.svg',
      'logo-2-trace.svg',
      'bad-name---trace.svg',
    ]);
    // Without a physical size the file stays in exact source pixels.
    expect(result.files[0]?.text).toContain('viewBox="0 0 1 1" width="100%" height="100%"');
    expect(result.files[0]?.text).toContain('d="M0 0L2 0 2 2 0 2z"');
    expect(trace).toHaveBeenNthCalledWith(1, rawImage(1, 1), customOptions);
    expect(trace).toHaveBeenNthCalledWith(2, rawImage(2, 2), DEFAULT_TRACE_OPTIONS);
  });

  it('writes physical dimensions and scales pixel geometry into millimetres', async () => {
    const result = await traceImagesToVectorFiles(
      [
        {
          sourceName: 'wide-logo.png',
          image: rawImage(1000, 500),
          physicalSizeMm: { widthMm: 100, heightMm: 50 },
        },
      ],
      { trace: async () => [SQUARE_PATH] },
    );

    expect(result.files[0]?.text).toContain('viewBox="0 0 100 50" width="100mm" height="50mm"');
    expect(result.files[0]?.text).toContain('d="M0 0h.2v.2h-.2z"');
  });

  it('skips degenerate and white-background traces instead of writing blank files', async () => {
    const trace = vi
      .fn()
      .mockResolvedValueOnce([ZERO_AREA_PATH])
      .mockResolvedValueOnce([BACKGROUND_PATH])
      .mockResolvedValueOnce([SQUARE_PATH]);
    const result = await traceImagesToVectorFiles(
      [
        { sourceName: 'transparent.png', image: rawImage(4, 4) },
        { sourceName: 'blank.png', image: rawImage(4, 4) },
        { sourceName: 'ink.png', image: rawImage(4, 4) },
      ],
      { trace },
    );

    expect(result.files.map((file) => [file.filename, file.sourceIndex])).toEqual([
      ['ink-trace.svg', 2],
    ]);
    expect(result.skipped.map((skip) => skip.sourceName)).toEqual(['transparent.png', 'blank.png']);
  });

  it('decodes a loader-shaped job on its turn', async () => {
    const load = vi.fn(async () => rawImage(4, 4));
    const result = await traceImagesToVectorFiles([{ sourceName: 'lazy.png', image: load }], {
      trace: async () => [SQUARE_PATH],
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.files[0]?.text).toContain('viewBox="0 0 4 4"');
  });

  it('hands DXF output to the injected writer with the page height', async () => {
    const writeDxf = vi.fn(() => 'DXF');
    const result = await traceImagesToVectorFiles(
      [
        {
          sourceName: 'a.png',
          image: rawImage(4, 4),
          physicalSizeMm: { widthMm: 8, heightMm: 8 },
        },
      ],
      { trace: async () => [SQUARE_PATH], writeDxf },
      { format: 'dxf', precisionMm: 0.01 },
    );
    expect(result.files[0]).toMatchObject({ filename: 'a-trace.dxf', format: 'dxf', text: 'DXF' });
    expect(writeDxf).toHaveBeenCalledWith(
      [expect.objectContaining({ color: '#000000' })],
      expect.objectContaining({ pageHeight: 8, precisionMm: 0.01 }),
    );
  });
});
