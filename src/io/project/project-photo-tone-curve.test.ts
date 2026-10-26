import { describe, expect, it } from 'vitest';
import { fitPhotoToneCurve } from '../../core/raster/photo-tone-curve';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  IDENTITY_TRANSFORM,
  LAYER_DEFAULTS,
  type Layer,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const CURVE = fitPhotoToneCurve(
  [20, 40, 60, 80].map((commandedPercent) => ({
    commandedPercent,
    observedPercent: Math.min(100, commandedPercent * 1.4),
  })),
  'Birch ply · Jarvis 254 DPI',
);
const PHOTO_CURVE = fitPhotoToneCurve([{ commandedPercent: 50, observedPercent: 75 }], 'Slate');

function projectWith(settings: Partial<Layer>, photoCurve = PHOTO_CURVE): Project {
  const base: Layer = {
    ...createLayer({ id: 'L1', color: '#808080', mode: 'image' }),
    ...settings,
  };
  const layer: Layer = {
    ...base,
    subLayers: [
      createLayerSubLayer(base, {
        id: 'sub-1',
        label: 'Second pass',
        settings: captureLayerOperationSettings({ ...base, photoToneCurve: CURVE }),
      }),
    ],
  };
  return {
    ...createProject(),
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'raster-image',
          id: 'R1',
          source: 'portrait.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          lumaBase64: 'gICAgA==',
          pixelWidth: 2,
          pixelHeight: 2,
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
          operationIds: ['L1'],
          dither: 'jarvis',
          linesPerMm: 10,
          operationOverride: { byOperation: { L1: { mode: 'image', photoToneCurve: photoCurve } } },
        },
      ],
    },
  };
}

describe('ADR-670 photo tone curves in project files', () => {
  it('round-trips curves on operations, sub-operations and photo overrides', () => {
    const loaded = deserializeProject(serializeProject(projectWith({ photoToneCurve: CURVE })));
    if (loaded.kind !== 'ok') throw new Error(`Expected load, got ${loaded.kind}`);
    const [layer] = loaded.project.scene.layers;
    expect(layer?.photoToneCurve).toEqual(CURVE);
    expect(layer?.subLayers[0]?.settings.photoToneCurve).toEqual(CURVE);
    expect(loaded.project.scene.objects[0]?.operationOverride).toEqual({
      byOperation: { L1: { mode: 'image', photoToneCurve: PHOTO_CURVE } },
    });
  });

  it('leaves an operation without a calibration exactly as before', () => {
    const plain = captureLayerOperationSettings({ ...LAYER_DEFAULTS, mode: 'image' });
    expect(Object.keys(plain)).not.toContain('photoToneCurve');
    const loaded = deserializeProject(serializeProject(projectWith({})));
    if (loaded.kind !== 'ok') throw new Error(`Expected load, got ${loaded.kind}`);
    expect(loaded.project.scene.layers[0]).not.toHaveProperty('photoToneCurve');
  });

  it.each([
    [
      'blank end that burns',
      {
        label: 'x',
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 240 },
        ],
      },
    ],
    [
      'falling curve',
      {
        label: 'x',
        points: [
          { input: 0, output: 0 },
          { input: 100, output: 200 },
          { input: 150, output: 100 },
          { input: 255, output: 255 },
        ],
      },
    ],
    ['wrong type', 'gamma 2'],
  ])('refuses a stored %s instead of burning it', (_name, bad) => {
    const raw = JSON.parse(serializeProject(projectWith({}))) as {
      scene: {
        layers: Array<Record<string, unknown>>;
        objects: Array<{
          operationOverride: { byOperation: Record<string, Record<string, unknown>> };
        }>;
      };
    };
    const onLayer = structuredClone(raw);
    onLayer.scene.layers[0] = { ...onLayer.scene.layers[0], photoToneCurve: bad };
    expect(deserializeProject(JSON.stringify(onLayer)).kind).toBe('invalid');
    const onPhoto = structuredClone(raw);
    const scoped = onPhoto.scene.objects[0]?.operationOverride.byOperation;
    if (scoped !== undefined) scoped['L1'] = { photoToneCurve: bad };
    expect(deserializeProject(JSON.stringify(onPhoto)).kind).toBe('invalid');
  });
});
