import { describe, expect, it } from 'vitest';
import {
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function raster(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    imageMaskId: 'M1',
    ...overrides,
  };
}

describe('project image mask persistence', () => {
  it('roundtrips a raster image mask reference', () => {
    const base = createProject();
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 2, heightMm: 1, cornerRadiusMm: 0 },
    });
    const scene = {
      objects: [raster(), mask],
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      groups: [],
    };
    const original: Project = { ...base, scene };

    const result = deserializeProject(serializeProject(original));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project).toEqual(original);
  });

  it('rejects a malformed image mask reference', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: addObject(base.scene, raster({ imageMaskId: 42 } as unknown as Partial<RasterImage>)),
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('scene.objects[0].imageMaskId');
    }
  });
});
