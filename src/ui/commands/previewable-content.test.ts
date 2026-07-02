import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type ReliefObject,
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

describe('hasPreviewableContent — CNC machine (H.5 / ADR-100)', () => {
  it('a relief-only scene previews in CNC mode but not in laser mode', () => {
    const scene: Project['scene'] = {
      objects: [reliefObject('relief', '#a0522d')],
      layers: [createLayer({ id: '#a0522d', color: '#a0522d' })],
    };

    expect(hasPreviewableContent(withScene(scene))).toBe(false);
    expect(hasPreviewableContent(asCnc(withScene(scene)))).toBe(true);
  });

  it('a relief on an output-disabled layer stays unpreviewable in CNC', () => {
    const project = asCnc(
      withScene({
        objects: [reliefObject('relief', '#a0522d')],
        layers: [{ ...createLayer({ id: '#a0522d', color: '#a0522d' }), output: false }],
      }),
    );

    expect(hasPreviewableContent(project)).toBe(false);
  });

  it('rasters are not previewable in CNC mode (compile drops them)', () => {
    const project = asCnc(
      withScene({
        objects: [rasterObject('image', '#808080')],
        layers: [createLayer({ id: '#808080', color: '#808080', mode: 'image' })],
      }),
    );

    expect(hasPreviewableContent(project)).toBe(false);
  });

  it('vectors on an image-mode layer preview in CNC (mode is a laser-only field)', () => {
    const project = asCnc(
      withScene({
        objects: [vectorObject('vector', '#808080')],
        layers: [createLayer({ id: '#808080', color: '#808080', mode: 'image' })],
      }),
    );

    expect(hasPreviewableContent(project)).toBe(true);
  });
});

function withScene(scene: Project['scene']): Project {
  return { ...createProject(), scene };
}

function asCnc(project: Project): Project {
  return { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG };
}

function reliefObject(id: string, color: string): ReliefObject {
  return {
    kind: 'relief',
    id,
    source: `${id}.stl`,
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 5],
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
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
