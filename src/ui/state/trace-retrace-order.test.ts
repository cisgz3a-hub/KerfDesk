import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { applyTraceToExisting } from './scene-mutations';

function raster(id: string, color: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 20,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function vectorReplacement(id: string): TracedImage {
  return {
    kind: 'traced-image',
    id,
    source: 'source.png',
    tracePixelWidth: 20,
    tracePixelHeight: 10,
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

function operationMode(project: Project, objectId: string): string | undefined {
  const object = project.scene.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) return undefined;
  const [operationId] = operationIdsForObject(object, project.scene.layers);
  return project.scene.layers.find((operation) => operation.id === operationId)?.mode;
}

describe('vector Re-trace replacement order', () => {
  it('replaces a same-id raster in place and prunes its superseded operation', () => {
    const source = raster('source-photo', '#808080');
    const before = raster('before', source.color);
    const prior: RasterImage = {
      ...raster('stable-result', '#909090'),
      traceSourceId: source.id,
      operationIds: ['old-trace-operation'],
    };
    const after = raster('after', source.color);
    const artworkOrder = [source.id, before.id, prior.id, after.id];
    const groups = [{ id: 'trace-group', name: 'Trace group', objectIds: [before.id, prior.id] }];
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [source, before, prior, after],
        layers: [
          createLayer({ id: 'source-image-operation', color: source.color, mode: 'image' }),
          createLayer({ id: 'old-trace-operation', color: prior.color, mode: 'image' }),
        ],
        artworkOrder,
        groups,
      },
    };

    const result = applyTraceToExisting(
      { project, undoStack: [] },
      source.id,
      vectorReplacement(prior.id),
      { replaceTraceId: prior.id },
    );

    expect(result.project.scene.objects.map((object) => object.id)).toEqual(artworkOrder);
    expect(result.project.scene.artworkOrder).toBe(artworkOrder);
    expect(result.project.scene.groups).toBe(groups);
    expect(result.project.scene.objects[2]?.kind).toBe('traced-image');
    expect(result.project.scene.layers.some((layer) => layer.id === 'old-trace-operation')).toBe(
      false,
    );
    expect(operationMode(result.project, prior.id)).toBe('fill');
  });
});
