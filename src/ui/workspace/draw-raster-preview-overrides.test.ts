import { afterEach, expect, it, vi } from 'vitest';
import {
  captureLayerOperationSettings,
  createLayerSubLayer,
  type RasterImage,
} from '../../core/scene';
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

for (const parent of [false, true])
  for (const override of [undefined, false, true])
    for (const traced of [false, true])
      it(`normalised preview agrees with compiler: parent=${parent}, override=${String(override)}, traced=${traced}`, () => {
        const raster: RasterImage = {
          ...previewRaster(),
          ...(traced ? { traceSourceId: 'source' } : {}),
          ...(override === undefined ? {} : { operationOverride: { negativeImage: override } }),
        };
        const p = previewProject([raster], [previewLayer({ negativeImage: parent })]),
          sink = previewSink();
        sink.draw(p);
        expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
      });
it('changes one same-ID override, restores inheritance, and leaves its shared parent/peer unchanged', () => {
  const first = previewRaster('a'),
    peer = { ...previewRaster('b'), operationOverride: { negativeImage: false } },
    layer = previewLayer({ negativeImage: true }),
    sink = previewSink();
  for (const override of [false, true, undefined, false]) {
    const p = previewProject(
      [
        {
          ...first,
          ...(override === undefined ? {} : { operationOverride: { negativeImage: override } }),
        },
        peer,
      ],
      [layer],
    );
    sink.drawn.length = 0;
    sink.draw(p);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
    expect(p.scene.objects[1]).toBe(peer);
    expect(p.scene.layers[0]).toBe(layer);
  }
  expect(sink.built).toHaveLength(3);
});
it('reuses the same effective preview when an overridden parent property changes', () => {
  const raster = { ...previewRaster(), operationOverride: { negativeImage: false } },
    sink = previewSink();
  sink.draw(previewProject([raster], [previewLayer({ negativeImage: false })]));
  sink.draw(previewProject([raster], [previewLayer({ negativeImage: true })]));
  expect(sink.built).toHaveLength(1);
});
for (const mode of ['image', 'line', 'fill'] as const)
  it(`matches compiler eligibility for object mode ${mode} on a line parent`, () => {
    const p = previewProject(
        [{ ...previewRaster(), operationOverride: { mode } }],
        [previewLayer({ mode: 'line' })],
      ),
      sink = previewSink();
    sink.draw(p);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
  });
it('keeps enabled suboperations/multiple bindings and ignores ordinary visibility', () => {
  const layer = previewLayer({ mode: 'line', visible: false }),
    second = previewLayer({ id: 'second', negativeImage: false });
  const sub = createLayerSubLayer(layer, {
    id: 'raster',
    label: 'Raster',
    settings: { ...captureLayerOperationSettings(layer), mode: 'image', negativeImage: true },
  });
  const p = previewProject(
      [
        {
          ...previewRaster(),
          operationIds: ['image', 'second'],
          operationOverride: { negativeImage: false },
        },
      ],
      [{ ...layer, subLayers: [sub] }, second],
    ),
    sink = previewSink();
  sink.draw(p);
  expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
  expect(sink.drawn).toHaveLength(2);
  expect(sink.built).toHaveLength(1);
});
it('excludes trace-source, disabled outputs and effective non-image objects', () => {
  const sink = previewSink(),
    layer = previewLayer();
  for (const p of [
    previewProject([{ ...previewRaster(), role: 'trace-source' }]),
    previewProject([previewRaster()], [{ ...layer, output: false }]),
    previewProject([{ ...previewRaster(), operationOverride: { mode: 'line' } }]),
  ]) {
    sink.draw(p);
    expect(normalizedCompiledPixels(p)).toEqual([]);
  }
  expect(sink.drawn).toEqual([]);
  expect(sink.built).toEqual([]);
});
for (const scale of [0, 37, 100])
  for (const algorithm of ['grayscale', 'threshold'] as const)
    it(`matches normalized effective min/max power with object scale ${scale}/${algorithm}`, () => {
      const p = previewProject([
          {
            ...previewRaster(),
            powerScale: scale,
            operationOverride: { minPower: 17, power: 29, ditherAlgorithm: algorithm },
          },
        ]),
        sink = previewSink();
      sink.draw(p);
      expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(p));
    });
