import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { traceImagesToVectorFiles } from '../../core/trace/batch-trace';
import type { BatchTraceFormat } from '../../core/trace/batch-trace';
import { coloredPathsToSvg, countVisibleColoredPaths } from '../../core/trace/paths-to-svg';
import { DEFAULT_TRACE_OPTIONS, type RawImageData } from '../../core/trace/trace-image';
import type { TraceOptions } from '../../core/trace/trace-option-types';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import { writeTracedDrawing } from './traced-drawing';

const FORMATS = ['svg', 'pdf', 'eps', 'geojson'] as const;

function svgPaths(text: string): Element[] {
  return [...new DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('path')];
}

type GeoFeature = {
  properties: { color: string; paint: string };
  geometry: { type: string; coordinates: unknown[] };
};

function geoFeatures(text: string): GeoFeature[] {
  return (JSON.parse(text) as { features: GeoFeature[] }).features;
}

function expectPaint(text: string, format: BatchTraceFormat, fills: number, strokes: number): void {
  if (format === 'svg') {
    const paths = svgPaths(text);
    expect(paths.filter((path) => path.getAttribute('fill') !== 'none')).toHaveLength(fills);
    expect(paths.filter((path) => path.getAttribute('stroke') !== 'none')).toHaveLength(strokes);
  } else if (format === 'pdf') {
    expect(text.match(/^f\*?$/gm) ?? []).toHaveLength(fills);
    expect(text.match(/^S$/gm) ?? []).toHaveLength(strokes);
  } else if (format === 'eps') {
    expect(text.match(/^(?:eofill|fill)$/gm) ?? []).toHaveLength(fills);
    expect(text.match(/^stroke$/gm) ?? []).toHaveLength(strokes);
  } else {
    const features = geoFeatures(text);
    expect(features.filter((feature) => feature.properties.paint === 'fill')).toHaveLength(fills);
    expect(features.filter((feature) => feature.properties.paint === 'stroke')).toHaveLength(
      strokes,
    );
  }
}

function subpathCount(text: string, format: BatchTraceFormat): number {
  if (format === 'svg') {
    return svgPaths(text).reduce(
      (count, path) => count + (path.getAttribute('d')?.match(/[mM]/g) ?? []).length,
      0,
    );
  }
  if (format === 'pdf' || format === 'eps')
    return (text.match(/[\d.-]+ [\d.-]+ m\b/g) ?? []).length;
  return geoFeatures(text).reduce(
    (count, feature) =>
      count + (feature.geometry.type === 'LineString' ? 1 : feature.geometry.coordinates.length),
    0,
  );
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

// Blue means stroke only in Hybrid. Its first closed contour encloses no
// area, but travels four pixels out and back; its second contour is open.
const MIXED_PATHS: readonly ColoredPath[] = [
  {
    color: '#000000',
    polylines: [
      {
        closed: true,
        points: [
          { x: 2, y: 2 },
          { x: 6, y: 2 },
          { x: 6, y: 6 },
          { x: 2, y: 6 },
        ],
      },
    ],
  },
  {
    color: '#0000ff',
    polylines: [
      {
        closed: true,
        points: [
          { x: 8, y: 8 },
          { x: 12, y: 8 },
        ],
      },
      {
        closed: false,
        points: [
          { x: 8, y: 12 },
          { x: 12, y: 12 },
        ],
      },
    ],
  },
];

describe('Multi-File Trace paint intent through real writers', () => {
  it.each(
    FORMATS.flatMap((format) => (['image', 'artwork'] as const).map((fit) => ({ format, fit }))),
  )(
    'strokes an actual default Edge Detection ring in $format on the $fit page',
    async ({ format, fit }) => {
      const image = solidSquare();
      const options = TRACE_PRESETS['Edge Detection'];
      if (options === undefined) throw new Error('Edge Detection preset missing');
      const paths = await traceImageToColoredPaths(image, options);
      const curves = paths.flatMap((path) => path.curves ?? []);
      expect(curves).toHaveLength(1);
      expect(curves[0]?.closed).toBe(true);
      expectPaint(coloredPathsToSvg(paths, 64, 64, undefined, 'edge'), 'svg', 0, 1);

      // Use the ordinary batch trace path too, not a hand-built writer input.
      const result = await traceImagesToVectorFiles(
        [{ sourceName: 'edge.png', image, options, physicalSizeMm: { widthMm: 16, heightMm: 16 } }],
        { writeDrawing: writeTracedDrawing },
        { format, groupContours: true, page: { fit } },
      );
      expect(result.skipped).toEqual([]);
      expect(result.files).toHaveLength(1);
      const text = result.files[0]?.text ?? '';
      expectPaint(text, format, 0, 1);
      expect(subpathCount(text, format)).toBe(1);
      if (format === 'geojson') expect(geoFeatures(text)[0]?.geometry.type).toBe('LineString');
    },
  );

  it.each(['svg', 'pdf', 'eps'] as const)('retains a closed Edge cubic in %s', async (format) => {
    const path: ColoredPath = {
      color: '#000000',
      // Compatibility polylines must not replace the canonical cubic.
      polylines: [],
      curves: [
        {
          start: { x: 10, y: 30 },
          closed: true,
          segments: [
            {
              kind: 'cubic',
              control1: { x: 10, y: 10 },
              control2: { x: 50, y: 10 },
              to: { x: 50, y: 30 },
            },
          ],
        },
      ],
    };
    const result = await traceImagesToVectorFiles(
      [
        {
          sourceName: 'curve.png',
          image: solidSquare(),
          options: { ...DEFAULT_TRACE_OPTIONS, traceMode: 'edge' },
        },
      ],
      { trace: async () => [path], writeDrawing: writeTracedDrawing },
      { format },
    );
    const text = result.files[0]?.text ?? '';
    expectPaint(text, format, 0, 1);
    expect(subpathCount(text, format)).toBe(1);
    if (format === 'svg') expect(svgPaths(text)[0]?.getAttribute('d')).toMatch(/[cC]/);
    else expect(text).toContain('10 54 50 54 50 34 c');
  });

  for (const traceMode of ['edge', 'centerline', 'filled-contours', 'hybrid'] as const) {
    it.each(FORMATS)(
      `${traceMode} preserves its closed/open roles and visible travel in %s`,
      async (format) => {
        const options: TraceOptions = { ...DEFAULT_TRACE_OPTIONS, traceMode };
        const result = await traceImagesToVectorFiles(
          [{ sourceName: 'mixed.png', image: solidSquare(), options }],
          { trace: async () => MIXED_PATHS, writeDrawing: writeTracedDrawing },
          { format },
        );
        expect(result.skipped).toEqual([]);
        expect(result.files[0]?.pathCount).toBe(2);
        const text = result.files[0]?.text ?? '';
        const lineMode = traceMode === 'edge' || traceMode === 'centerline';
        const expectedSubpaths = traceMode === 'filled-contours' ? 2 : 3;
        expectPaint(text, format, lineMode ? 0 : 1, lineMode ? 2 : 1);
        expect(subpathCount(text, format)).toBe(expectedSubpaths);

        const preview = coloredPathsToSvg(MIXED_PATHS, 64, 64, undefined, traceMode);
        expect(countVisibleColoredPaths(MIXED_PATHS, traceMode)).toBe(2);
        expect(subpathCount(preview, 'svg')).toBe(expectedSubpaths);
        if (format === 'geojson') {
          const blue = geoFeatures(text).find((feature) => feature.properties.color === '#0000ff');
          expect(blue?.properties.paint).toBe('stroke');
          expect(blue?.geometry.coordinates).toEqual(
            traceMode === 'filled-contours'
              ? [
                  [8, 52],
                  [12, 52],
                ]
              : [
                  [
                    [8, 56],
                    [12, 56],
                    [8, 56],
                  ],
                  [
                    [8, 52],
                    [12, 52],
                  ],
                ],
          );
        }
      },
    );
  }
});
