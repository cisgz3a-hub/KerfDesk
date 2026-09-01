import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import { EMPTY_SCENE, type Scene } from './scene';
import { IDENTITY_TRANSFORM, type RasterImage } from './scene-object';
import { hitTestCandidates } from './hit-test-candidates';

describe('hitTestCandidates', () => {
  it('excludes artwork bound only to an exact hidden operation id', () => {
    expect(
      hitTestCandidates(scene([hiddenLayer()], raster(['hidden-op'])), { x: 5, y: 5 }),
    ).toEqual([]);
  });

  it('keeps artwork when any exact operation binding is visible', () => {
    expect(
      hitTestCandidates(
        scene(
          [hiddenLayer(), createLayer({ id: 'visible-op', color: '#222222' })],
          raster(['hidden-op', 'visible-op']),
        ),
        { x: 5, y: 5 },
      ),
    ).toEqual(['target']);
  });

  it('keeps the first operation for duplicate legacy color aliases', () => {
    expect(
      hitTestCandidates(
        scene([hiddenLayer(), createLayer({ id: 'later-visible', color: '#111111' })], raster()),
        { x: 5, y: 5 },
      ),
    ).toEqual([]);
  });
});

function scene(layers: Scene['layers'], object: RasterImage): Scene {
  return { ...EMPTY_SCENE, layers, objects: [object] };
}

function hiddenLayer() {
  return { ...createLayer({ id: 'hidden-op', color: '#111111' }), visible: false };
}

function raster(operationIds?: ReadonlyArray<string>): RasterImage {
  return {
    kind: 'raster-image',
    id: 'target',
    source: 'target.png',
    dataUrl: 'data:,',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#111111',
    dither: 'grayscale',
    linesPerMm: 1,
    ...(operationIds === undefined ? {} : { operationIds }),
  };
}
