// ADR-673: builds before it saved a picture kept behind a trace with
// `role: 'trace-source'` and left it out of every job. Such a project still
// opens and the marker is dropped: a kept photo engraves on its Image operation
// like any other image, a kept camera capture stays out of the job on an
// output-off operation, and the next save no longer writes the marker.
import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
} from '../../core/scene';
import { CAMERA_CAPTURE_SOURCE } from '../../core/scene/reference-image-output';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

const photo: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'portrait.jpg',
  dataUrl: 'data:image/png;base64,AAAA',
  lumaBase64: 'QEBAQA==',
  pixelWidth: 2,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'floyd-steinberg',
  linesPerMm: 5,
  operationIds: ['photo-operation'],
};

const trace: TracedImage = {
  kind: 'traced-image',
  id: 'trace',
  source: 'portrait.jpg',
  traceSourceId: 'photo',
  traceMode: 'filled-contours',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  operationIds: ['trace-operation'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 },
          ],
        },
      ],
    },
  ],
};

// A project as an earlier build saved it: the kept picture carries the marker.
function legacyDocument(objects: ReadonlyArray<SceneObject> = [photo, trace]): string {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [...objects],
      layers: [
        createLayer({ id: 'photo-operation', color: '#808080', mode: 'image' }),
        createLayer({ id: 'trace-operation', color: '#000000', mode: 'line' }),
      ],
      groups: [],
      artworkOrder: objects.map((object) => object.id),
    },
  };
  const json = JSON.parse(serializeProject(project)) as {
    scene: { objects: Array<Record<string, unknown>> };
  };
  const [savedPhoto] = json.scene.objects;
  if (savedPhoto === undefined) throw new Error('missing photo');
  savedPhoto['role'] = 'trace-source';
  return JSON.stringify(json);
}

function load(text: string): Project {
  const result = deserializeProject(text);
  if (result.kind !== 'ok') throw new Error(`load failed: ${result.kind}`);
  return result.project;
}

describe('a project saved with the legacy trace-source marker (ADR-673)', () => {
  it('opens with the kept photo as an ordinary image that engraves before the trace', () => {
    const loaded = load(legacyDocument());
    const [loadedPhoto, loadedTrace] = loaded.scene.objects;

    expect(loadedPhoto).toMatchObject({ kind: 'raster-image', id: 'photo' });
    expect(loadedPhoto).not.toHaveProperty('role');
    expect(loadedTrace).toMatchObject({ kind: 'traced-image', traceSourceId: 'photo' });
    expect(compileJob(loaded.scene, loaded.device).groups.map((group) => group.kind)).toEqual([
      'raster',
      'cut',
    ]);
  });

  it('saves without the marker and without validation drift', () => {
    const loaded = load(legacyDocument());
    const prepared = prepareProjectForPersistence(loaded);

    expect(prepared.kind).toBe('ok');
    expect(serializeProject(loaded)).not.toContain('trace-source');
  });

  it('still refuses a role this build does not know', () => {
    const unknownRole = legacyDocument().replace('"trace-source"', '"reference"');
    expect(deserializeProject(unknownRole).kind).toBe('invalid');
  });

  it('keeps a legacy kept camera capture out of the job on its own operation', () => {
    const capture: RasterImage = { ...photo, source: CAMERA_CAPTURE_SOURCE };
    const loaded = load(legacyDocument([capture, trace]));
    const loadedCapture = loaded.scene.objects[0];
    if (loadedCapture === undefined) throw new Error('missing capture');

    expect(loadedCapture).not.toHaveProperty('role');
    expect(operationIdsForObject(loadedCapture, loaded.scene.layers)).toEqual(['photo-operation']);
    expect(loaded.scene.layers.find((layer) => layer.id === 'photo-operation')?.output).toBe(false);
    expect(compileJob(loaded.scene, loaded.device).groups.map((group) => group.kind)).toEqual([
      'cut',
    ]);
    expect(prepareProjectForPersistence(loaded).kind).toBe('ok');
  });

  it('moves a legacy camera capture off an operation its raster trace shares', () => {
    const capture: RasterImage = { ...photo, source: CAMERA_CAPTURE_SOURCE };
    const rasterResult: RasterImage = {
      ...photo,
      id: 'raster-trace',
      source: 'camera capture (trace bitmap)',
      traceSourceId: capture.id,
    };
    const loaded = load(legacyDocument([capture, rasterResult]));
    const [loadedCapture] = loaded.scene.objects;
    if (loadedCapture === undefined) throw new Error('missing capture');
    const captureOperations = operationIdsForObject(loadedCapture, loaded.scene.layers);
    const captureOperation = loaded.scene.layers.find((layer) => layer.id === captureOperations[0]);

    expect(captureOperations).not.toContain('photo-operation');
    expect(captureOperation).toMatchObject({ mode: 'image', output: false });
    expect(loaded.scene.layers.find((layer) => layer.id === 'photo-operation')?.output).toBe(true);
    expect(
      compileJob(loaded.scene, loaded.device).groups.flatMap((group) =>
        group.kind === 'raster' ? [group.sourceObjectId] : [],
      ),
    ).toEqual(['raster-trace']);
    expect(prepareProjectForPersistence(loaded).kind).toBe('ok');
  });
});
