// ADR-648: builds before it saved a photo kept behind a trace with
// `role: 'trace-source'` and left it out of every job. Such a project still
// opens; the marker is dropped, so the photo engraves on its Image operation
// like any other image, and the next save no longer writes the marker.
import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
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

// A project as an earlier build saved it: the kept photo carries the marker.
function legacyDocument(): string {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [photo, trace],
      layers: [
        createLayer({ id: 'photo-operation', color: '#808080', mode: 'image' }),
        createLayer({ id: 'trace-operation', color: '#000000', mode: 'line' }),
      ],
      groups: [],
      artworkOrder: ['photo', 'trace'],
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

describe('a project saved with the legacy trace-source marker (ADR-648)', () => {
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
});
