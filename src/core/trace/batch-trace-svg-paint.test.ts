import { describe, expect, it } from 'vitest';
import type { ColoredPath, CurveSubpath } from '../scene';
import { traceImagesToVectorFiles } from './batch-trace';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

const closedCurve: CurveSubpath = {
  start: { x: 1, y: 3 },
  closed: true,
  segments: [
    {
      kind: 'cubic',
      control1: { x: 1, y: 1 },
      control2: { x: 3, y: 1 },
      to: { x: 3, y: 3 },
    },
  ],
};
const openCurve: CurveSubpath = {
  start: { x: 4, y: 3 },
  closed: false,
  segments: [
    {
      kind: 'cubic',
      control1: { x: 4, y: 1 },
      control2: { x: 7, y: 1 },
      to: { x: 7, y: 3 },
    },
  ],
};
const curves: ColoredPath = {
  color: '#000000',
  // Only canonical geometry exists; an empty compatibility view must not
  // erase the cubic or the open branch from the exported SVG.
  polylines: [],
  curves: [closedCurve, openCurve],
};
const outAndBack: ColoredPath = {
  color: '#000000',
  polylines: [],
  curves: [
    { start: { x: 1, y: 6 }, closed: true, segments: [{ kind: 'line', to: { x: 3, y: 6 } }] },
  ],
};

function svgPaths(text: string): Element[] {
  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return [...document.querySelectorAll('path')];
}

function exportPaths(
  paths: ColoredPath[],
  traceMode: NonNullable<TraceOptions['traceMode']>,
  group = false,
) {
  return traceImagesToVectorFiles(
    [
      {
        sourceName: 'trace.png',
        image: { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) },
        physicalSizeMm: { widthMm: 16, heightMm: 8 },
        options: { ...DEFAULT_TRACE_OPTIONS, traceMode },
      },
    ],
    { trace: async () => paths },
    { groupContours: group },
  );
}

function expectStroke(path: Element, width: number): void {
  expect(path.getAttribute('fill')).toBe('none');
  expect(path.getAttribute('stroke')).toBe('#000000');
  expect(Number(path.getAttribute('stroke-width'))).toBe(width);
  expect(path.getAttribute('fill-rule')).toBeNull();
  expect(path.getAttribute('stroke-linecap')).toBe('round');
  expect(path.getAttribute('stroke-linejoin')).toBe('round');
}

function solidSquare(): RawImageData {
  const width = 64;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x >= 12 && x < 52 && y >= 12 && y < 52 ? 0 : 255;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { width, height: width, data };
}

describe('Multi-File Trace SVG paint intent', () => {
  it.each(
    (['edge', 'centerline'] as const).flatMap((mode) =>
      [false, true].map((group) => ({ mode, group })),
    ),
  )(
    'retains closed and open canonical $mode strokes with grouping=$group',
    async ({ mode, group }) => {
      const result = await exportPaths([curves], mode, group);
      expect(result.skipped).toEqual([]);
      expect(result.files).toHaveLength(1);
      const text = result.files[0]?.text ?? '';
      expect(text).toContain('viewBox="0 0 16 8" width="16mm" height="8mm"');
      const paths = svgPaths(text);
      expect(paths).toHaveLength(1);
      expectStroke(paths[0]!, 2);
      const d = paths[0]?.getAttribute('d') ?? '';
      expect(d.match(/[cC]/g)).toHaveLength(2);
      expect(d.match(/[mM]/g)).toHaveLength(2);
      expect(d.match(/[zZ]/g)).toHaveLength(1);
      expect(d).not.toMatch(/[zZ]$/); // The open branch remains open and visible.
    },
  );

  it.each(['edge', 'centerline'] as const)(
    'counts zero-area closed %s travel as visible ink',
    async (mode) => {
      const result = await exportPaths([outAndBack], mode);
      expect(result.skipped).toEqual([]);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.pathCount).toBe(1);
      const paths = svgPaths(result.files[0]?.text ?? '');
      expect(paths).toHaveLength(1);
      expectStroke(paths[0]!, 2);
      expect(paths[0]?.getAttribute('d')).toBe('M2 6h4z');
    },
  );

  it.each([false, true])(
    'preserves Silhouette fills and open strokes with grouping=%s',
    async (group) => {
      const result = await exportPaths([curves, outAndBack], 'filled-contours', group);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.pathCount).toBe(1); // Zero-area fill still has no ink.
      const paths = svgPaths(result.files[0]?.text ?? '');
      expect(paths).toHaveLength(2);
      expect(paths[0]?.getAttribute('fill')).toBe('#000000');
      expect(paths[0]?.getAttribute('stroke')).toBe('none');
      expect(paths[0]?.getAttribute('fill-rule')).toBe('evenodd');
      expect(paths[0]?.getAttribute('d')).toMatch(/[cC].*[zZ]$/);
      expectStroke(paths[1]!, 2);
      expect(paths[1]?.getAttribute('d')).toMatch(/[cC]/);
      expect(paths[1]?.getAttribute('d')).not.toMatch(/[zZ]/);
    },
  );

  it('strokes a real default Edge Detection result through the ordinary batch path', async () => {
    const options = TRACE_PRESETS['Edge Detection'];
    if (options === undefined) throw new Error('Edge Detection preset missing');
    const result = await traceImagesToVectorFiles([
      {
        sourceName: 'edge.png',
        image: solidSquare(),
        options,
        physicalSizeMm: { widthMm: 16, heightMm: 16 },
      },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.files).toHaveLength(1);
    const paths = svgPaths(result.files[0]?.text ?? '');
    expect(paths).toHaveLength(1);
    expectStroke(paths[0]!, 0.25);
    expect(paths[0]?.getAttribute('d')).toMatch(/[zZ]$/);
  });
});
