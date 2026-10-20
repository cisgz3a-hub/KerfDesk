import { describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type ColoredPath } from '../../../core/scene';
import { DEFAULT_TRACE_OPTIONS } from '../../../core/trace';
import type { PreparedTrace } from '../../trace/prepared-trace';
import {
  buildJigTraceObject,
  currentJigTracePreview,
  type JigTraceSource,
} from './jig-trace-import';

const file = new File(['image'], 'logo.png', { type: 'image/png' });
const source: JigTraceSource = {
  file,
  dataUrl: 'data:image/png;base64,AA==',
  natural: { width: 1000, height: 500 },
  density: null,
};
const options = DEFAULT_TRACE_OPTIONS;
const paths: ColoredPath[] = [
  {
    color: '#000000',
    polylines: [
      {
        points: [
          { x: 10, y: 5 },
          { x: 80, y: 40 },
        ],
        closed: false,
      },
    ],
  },
];
const prepared: PreparedTrace = {
  request: { file, options, boundary: null, boundaryMode: 'crop' },
  result: { paths, bounds: { minX: 10, minY: 5, maxX: 80, maxY: 40 }, width: 100, height: 50 },
};

describe('inline jig trace import', () => {
  it('uses exact preview geometry and working grid while preserving physical image size', async () => {
    const object = await buildJigTraceObject({
      source,
      options,
      preparedTrace: prepared,
      project: createProject(),
    });
    expect(object.kind).toBe('traced-image');
    expect(object.source).toBe('logo.png');
    expect(object.tracePixelWidth).toBe(100);
    expect(object.tracePixelHeight).toBe(50);
    expect(object.bounds).toBe(prepared.result.bounds);
    expect(object.paths).toBe(paths);
    expect(object.transform.scaleX).toBeCloseTo(1);
    expect(object.transform.scaleY).toBeCloseTo(1);
    expect(object.traceSourceId).toBeUndefined();
  });

  it('respects image DPI and preserves centerline mode', async () => {
    const centerline = { ...options, traceMode: 'centerline' as const };
    const object = await buildJigTraceObject({
      source: { ...source, density: { xDpi: 508, yDpi: 254 } },
      options: centerline,
      preparedTrace: { ...prepared, request: { ...prepared.request, options: centerline } },
      project: createProject(),
    });
    expect(object.traceMode).toBe('centerline');
    expect(object.transform.scaleX).toBeCloseTo(0.5);
    expect(object.transform.scaleY).toBeCloseTo(1);
  });

  it('lays a trace of a jig image over that image at its placed size', async () => {
    const image = {
      kind: 'raster-image' as const,
      id: 'photo',
      source: 'logo.png',
      pixelWidth: 1000,
      pixelHeight: 500,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
      transform: { ...IDENTITY_TRANSFORM, x: 150, y: 175, rotationDeg: 90 },
      color: '#123456',
      dither: 'threshold' as const,
      linesPerMm: 10,
    };
    const object = await buildJigTraceObject({
      source: { ...source, image },
      options,
      preparedTrace: prepared,
      project: createProject(),
    });
    // 100 x 50 trace grid across the 40 x 20 mm image, at its position and turn.
    expect(object.transform).toMatchObject({ x: 150, y: 175, rotationDeg: 90 });
    expect(object.transform.scaleX).toBeCloseTo(0.4);
    expect(object.transform.scaleY).toBeCloseTo(0.4);
  });

  it('does not publish empty trace geometry', async () => {
    await expect(
      buildJigTraceObject({
        source,
        options,
        preparedTrace: { ...prepared, result: { ...prepared.result, paths: [] } },
        project: createProject(),
      }),
    ).rejects.toThrow('No trace paths');
  });

  it('hides a prepared preview immediately when its file or settings are stale', () => {
    const preview = {
      kind: 'ready' as const,
      svg: '<svg/>',
      width: 100,
      height: 50,
      paths,
      preparedTrace: prepared,
    };
    expect(currentJigTracePreview(source, options, preview)).toBe(preview);
    expect(currentJigTracePreview(source, { ...options }, preview).kind).toBe('tracing');
    expect(
      currentJigTracePreview({ ...source, file: new File(['new'], 'new.png') }, options, preview)
        .kind,
    ).toBe('tracing');
    expect(currentJigTracePreview(null, options, preview).kind).toBe('idle');
  });
});
