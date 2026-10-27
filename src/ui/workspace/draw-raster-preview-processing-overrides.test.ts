import { afterEach, expect, it, vi } from 'vitest';
import { compileJob } from '../../core/job';
import type { PhotoToneCurve } from '../../core/raster/photo-tone-curve';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import {
  gray,
  normalizedCompiledPixels,
  previewLayer,
  previewProject,
  previewRaster,
  previewSink,
} from './raster-preview.test-support';

afterEach(() => {
  previewSink().draw(previewProject([]));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const passThrough of [false, true])
  it(`uses effective density and pass-through=${passThrough} with adjustments`, () => {
    const raster = {
      ...previewRaster(),
      brightness: -12,
      contrast: 35,
      gamma: 0.7,
      operationOverride: {
        passThrough,
        linesPerMm: 2,
        negativeImage: false,
        ditherAlgorithm: 'grayscale' as const,
      },
    };
    const p = previewProject(
        [raster],
        [previewLayer({ passThrough: !passThrough, linesPerMm: 3, negativeImage: true })],
      ),
      sink = previewSink();
    sink.draw(p);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
    expect(sink.drawn[0]).toMatchObject({
      width: passThrough ? 8 : 16,
      height: passThrough ? 4 : 8,
    });
  });

it('invalidates same-ID image adjustments and effective object power scale', () => {
  const raster = {
      ...previewRaster(),
      operationOverride: { ditherAlgorithm: 'grayscale' as const, power: 29, minPower: 17 },
    },
    sink = previewSink();
  for (const patch of [
    { brightness: 24 },
    { contrast: 20 },
    { gamma: 1.6 },
    { powerScale: 0 },
    { powerScale: 37 },
  ]) {
    const p = previewProject([{ ...raster, ...patch }]);
    sink.drawn.length = 0;
    sink.draw(p);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
  }
  expect(sink.built).toHaveLength(5);
});

it('rebuilds a same-ID preview when only its sharpening changes (ADR-671)', () => {
  const raster = {
      ...previewRaster(),
      operationOverride: { ditherAlgorithm: 'grayscale' as const },
    },
    sink = previewSink();
  for (const patch of [{}, { sharpenAmount: 150 }, { sharpenAmount: 150, sharpenRadius: 2 }]) {
    const p = previewProject([{ ...raster, ...patch }]);
    sink.drawn.length = 0;
    sink.draw(p);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
  }
  expect(sink.built).toHaveLength(3);
});

// ADR-670 Amendment 1 (audit G9-P2-1): the curve keys the cached canvas, so
// Preview shows the tones the G-code burns after a calibration is applied.
it('rebuilds a same-ID preview when only its tone curve changes', () => {
  const curve: PhotoToneCurve = {
    label: 'Birch',
    points: [
      { input: 0, output: 0 },
      { input: 128, output: 64 },
      { input: 255, output: 255 },
    ],
  };
  const grayscale = previewLayer({ ditherAlgorithm: 'grayscale' });
  const raster = previewRaster(),
    sink = previewSink();
  const drawn = (p: ReturnType<typeof previewProject>): number[][] => {
    sink.drawn.length = 0;
    sink.draw(p);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
    return sink.drawn.map(gray);
  };
  const plain = drawn(previewProject([raster], [grayscale]));
  // Photo engraving Apply writes the curve into the artwork override.
  const overridden = drawn(
    previewProject([{ ...raster, operationOverride: { photoToneCurve: curve } }], [grayscale]),
  );
  expect(overridden).not.toEqual(plain);
  expect(sink.built).toHaveLength(2);
  // A renamed curve burns the same tones, so its canvas is reused.
  drawn(
    previewProject(
      [{ ...raster, operationOverride: { photoToneCurve: { ...curve, label: 'Birch 2' } } }],
      [grayscale],
    ),
  );
  expect(sink.built).toHaveLength(2);
  // A process recipe can put a curve on the operation itself.
  const steeper = {
    ...curve,
    points: [curve.points[0]!, { input: 128, output: 32 }, curve.points[2]!],
  };
  drawn(previewProject([raster], [{ ...grayscale, photoToneCurve: steeper }]));
  expect(sink.built).toHaveLength(3);
});

function mask(): SceneObject {
  return {
    kind: 'shape',
    id: 'mask',
    color: '#808080',
    spec: { kind: 'rect', widthMm: 4, heightMm: 4, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: { ...IDENTITY_TRANSFORM, x: 2 },
    paths: [
      {
        color: '#808080',
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
      },
    ],
  };
}

it('preserves masked white background and invalidates a moved mask under overridden polarity', () => {
  const raster = {
      ...previewRaster(),
      imageMaskId: 'mask',
      operationOverride: { negativeImage: false, ditherAlgorithm: 'grayscale' as const },
    },
    sink = previewSink(),
    originalMask = mask();
  for (const x of [2, 0]) {
    const p = previewProject(
      [raster, { ...originalMask, transform: { ...originalMask.transform, x } }],
      [previewLayer({ negativeImage: true })],
    );
    sink.drawn.length = 0;
    sink.draw(p);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
    expect(gray(sink.drawn[0]!)[7]).toBe(255);
  }
  expect(sink.built).toHaveLength(2);
});

for (const algorithm of ['ordered', 'floyd-steinberg', 'jarvis'] as const)
  it(`matches compiled machine rows for ${algorithm} with effective overrides`, () => {
    const raster = {
        ...previewRaster(),
        operationOverride: {
          ditherAlgorithm: algorithm,
          negativeImage: false,
          minPower: 17,
          power: 29,
        },
      },
      parent = previewLayer({ negativeImage: true }),
      p = previewProject([raster], [parent]),
      sink = previewSink();
    sink.draw(p);
    // Preview now displays exact compiled machine rows on the absolute S scale.
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
  });

it('retains the 2048 preview edge while effective density keeps the larger compiler grid', () => {
  const raster = { ...previewRaster(), operationOverride: { linesPerMm: 300, passThrough: false } },
    p = previewProject([raster], [previewLayer({ passThrough: true })]),
    sink = previewSink();
  sink.draw(p);
  expect(sink.drawn[0]).toMatchObject({ width: 2048, height: 1024 });
  const group = compileJob(p.scene, p.device).groups.find((g) => g.kind === 'raster');
  expect(group).toMatchObject({ kind: 'raster', pixelWidth: 2400, pixelHeight: 1200 });
  expect(raster.pixelWidth).toBe(8);
  expect(raster.pixelHeight).toBe(4);
});
