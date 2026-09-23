import { describe, expect, it } from 'vitest';
import {
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
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
    if (result.kind === 'ok') {
      expect(serializeProject(result.project)).toBe(serializeProject(original));
    }
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

  it('persists a local clip and source fragment metadata without creating mask artwork', () => {
    const base = createProject();
    const paths = createRectangle({
      id: 'clip-source',
      color: '#000000',
      spec: { widthMm: 2, heightMm: 1, cornerRadiusMm: 0 },
    }).paths;
    const source = raster({
      imageClip: paths,
      svgImport: {
        id: 'source-fragment',
        source: 'mixed.svg',
        transform: { ...IDENTITY_TRANSFORM, x: 23, rotationDeg: 31 },
      },
    });
    const original = { ...base, scene: { ...base.scene, objects: [source] } };
    const saved = serializeProject(original);
    const result = deserializeProject(saved);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw Error('Expected a valid clip project.');
    expect(result.project.scene.objects).toHaveLength(1);
    expect(result.project.scene.objects[0]).toMatchObject({
      imageClip: paths,
      svgImport: source.svgImport,
    });
    expect(serializeProject(result.project)).toBe(saved);
  });

  it.each([
    { imageClip: {} },
    {
      imageClip: [
        { color: '#000000', polylines: [{ closed: true, points: [{ x: 'bad', y: 0 }] }] },
      ],
    },
    {
      imageClip: [
        {
          color: '#000000',
          polylines: [],
          curves: [
            {
              start: { x: 0, y: 0 },
              closed: true,
              segments: [{ kind: 'line', to: { x: null, y: 0 } }],
            },
          ],
        },
      ],
    },
    { svgImport: { id: 1, source: 'mixed.svg', transform: IDENTITY_TRANSFORM } },
    {
      svgImport: {
        id: 'fragment',
        source: 'mixed.svg',
        transform: { ...IDENTITY_TRANSFORM, scaleX: 'bad' },
      },
    },
  ])('rejects malformed local clip or source metadata: %j', (patch) => {
    const base = createProject();
    const result = deserializeProject(
      JSON.stringify({
        ...base,
        scene: { ...base.scene, objects: [{ ...raster(), ...patch }] },
      }),
    );
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('scene.objects[0]');
  });

  it('retains an explicitly empty clip through persistence', () => {
    const base = createProject();
    const result = deserializeProject(
      serializeProject({
        ...base,
        scene: { ...base.scene, objects: [raster({ imageClip: [] })] },
      }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok')
      expect(result.project.scene.objects[0]).toMatchObject({ imageClip: [] });
  });
});
