// Dither values across KerfDesk versions (ADR-649). A new dither is added
// without a schema bump because every reader validates the stored value
// against its own DITHER_ALGORITHMS: a build that does not know a value refuses
// the project rather than burning it with some other dither. These tests pin
// both halves: this build keeps 'blue-noise' wherever a dither is stored, and
// refuses a value it does not know (which is how an older build meets
// 'blue-noise').

import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const COLOR = '#808080';

function photoProject(): Project {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'portrait',
    color: COLOR,
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'blue-noise',
    linesPerMm: 10,
    lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
    bounds: { minX: 10, minY: 10, maxX: 14, maxY: 14 },
    transform: IDENTITY_TRANSFORM,
    operationOverride: { ditherAlgorithm: 'blue-noise' },
  };
  const project = createProject();
  const layer = createLayer({ id: 'photo', color: COLOR, mode: 'image' });
  return {
    ...project,
    scene: addLayer(addObject(project.scene, image), {
      ...layer,
      ditherAlgorithm: 'blue-noise',
    }),
  };
}

type Raw = {
  scene: {
    layers: Array<Record<string, unknown>>;
    objects: Array<Record<string, unknown> & { operationOverride: Record<string, unknown> }>;
  };
};

function rawPhotoProject(): Raw {
  return JSON.parse(serializeProject(photoProject())) as Raw;
}

describe('stored dither values across versions', () => {
  it('keeps blue-noise on the operation, the image and an artwork override', () => {
    const loaded = deserializeProject(serializeProject(photoProject()));
    if (loaded.kind !== 'ok') throw new Error(`refused: ${JSON.stringify(loaded)}`);
    const layer = loaded.project.scene.layers.find((candidate) => candidate.id === 'photo');
    const image = loaded.project.scene.objects.find((object) => object.id === 'portrait');
    expect(layer?.ditherAlgorithm).toBe('blue-noise');
    expect(image?.kind === 'raster-image' ? image.dither : null).toBe('blue-noise');
    expect(image?.operationOverride?.ditherAlgorithm).toBe('blue-noise');
  });

  const plants: ReadonlyArray<readonly [string, (raw: Raw) => void]> = [
    [
      'operation',
      (raw) => {
        raw.scene.layers.find((l) => l['id'] === 'photo')!['ditherAlgorithm'] = 'next-dither';
      },
    ],
    [
      'image',
      (raw) => {
        raw.scene.objects[0]!['dither'] = 'next-dither';
      },
    ],
    [
      'artwork override',
      (raw) => {
        raw.scene.objects[0]!.operationOverride['ditherAlgorithm'] = 'next-dither';
      },
    ],
  ];

  it.each(plants)('refuses a dither on the %s that this build does not know', (_place, plant) => {
    const raw = rawPhotoProject();
    plant(raw);
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.kind).toBe('invalid');
    expect(loaded.kind === 'invalid' ? loaded.reason : '').toMatch(/dither/i);
  });
});
