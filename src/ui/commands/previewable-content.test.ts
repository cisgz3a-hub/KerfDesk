import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { hasPreviewableContent } from './previewable-content';

describe('hasPreviewableContent', () => {
  it('is false when an output layer exists but no object belongs to it', () => {
    const project = withScene({
      objects: [vectorObject('vector', '#ff0000')],
      layers: [
        { ...createLayer({ id: '#ff0000', color: '#ff0000' }), output: false },
        createLayer({ id: '#00ff00', color: '#00ff00' }),
      ],
    });

    expect(hasPreviewableContent(project)).toBe(false);
  });

  it('is true for vector geometry on an output-enabled vector layer', () => {
    const project = withScene({
      objects: [vectorObject('vector', '#ff0000')],
      layers: [createLayer({ id: '#ff0000', color: '#ff0000' })],
    });

    expect(hasPreviewableContent(project)).toBe(true);
  });

  it('is true for raster geometry on an output-enabled image layer', () => {
    const project = withScene({
      objects: [rasterObject('image', '#808080')],
      layers: [createLayer({ id: '#808080', color: '#808080', mode: 'image' })],
    });

    expect(hasPreviewableContent(project)).toBe(true);
  });

  it('ignores trace-source raster backing images', () => {
    const project = withScene({
      objects: [{ ...rasterObject('image', '#808080'), role: 'trace-source' }],
      layers: [createLayer({ id: '#808080', color: '#808080', mode: 'image' })],
    });

    expect(hasPreviewableContent(project)).toBe(false);
  });
});

function withScene(scene: Project['scene']): Project {
  return { ...createProject(), scene };
}

function vectorObject(id: string, color: string): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

function rasterObject(id: string, color: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'AA==',
  };
}
