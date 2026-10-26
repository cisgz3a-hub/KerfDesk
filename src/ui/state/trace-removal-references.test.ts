import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TextObject,
  type TracedImage,
} from '../../core/scene';
import { validateSceneIntegrity } from '../../io/project/project-scene-integrity-validator';
import {
  deserializeProject,
  prepareProjectForPersistence,
  serializeProject,
} from '../../io/project';
import { applyTraceToExisting } from './scene-mutations';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';
import { svgObj } from './test-helpers';

function photo(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,AAAAAA==',
    lumaBase64: 'AAAAAA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 23, y: 41, rotationDeg: 27, mirrorX: true },
    color: '#808080',
    operationIds: ['image'],
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function vector(id: string): TracedImage {
  return { ...svgObj(id, ['#000000']), kind: 'traced-image', traceSourceId: 'source' };
}

function project(): Project {
  const source = photo('source');
  const mask: RasterImage = { ...photo('masked'), imageMaskId: 'prior' };
  const text: TextObject = {
    ...svgObj('text', ['#000000']),
    kind: 'text',
    color: '#000000',
    content: 'Retained text',
    fontKey: 'roboto',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    pathText: { guideObjectId: 'prior', offsetMm: 2, reverse: false },
  };
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [source, vector('prior'), mask, text],
      layers: [
        { ...createLayer({ id: 'image', color: '#808080', mode: 'image' }), power: 43 },
        { ...createLayer({ id: 'vector', color: '#000000', mode: 'line' }), power: 12 },
      ],
      groups: [{ id: 'source-pair', name: 'Source pair', objectIds: ['source', 'prior'] }],
      designTreeOrder: [
        { kind: 'group', id: 'source-pair' },
        { kind: 'object', id: 'prior' },
        { kind: 'object', id: 'text' },
      ],
    },
  };
}

describe.each(['vector', 'raster'] as const)('%s trace removal references', (kind) => {
  const commit = (before: Project, removeSource: boolean) =>
    kind === 'vector'
      ? applyTraceToExisting({ project: before, undoStack: [] }, 'source', vector('replacement'), {
          deleteSourceAfterTrace: removeSource,
          replaceTraceId: 'prior',
        })
      : applyRasterizedTraceToExisting(
          { project: before, undoStack: [] },
          'source',
          photo('replacement'),
          { deleteSourceAfterTrace: removeSource, replaceTraceId: 'prior' },
        );

  it.each([false, true])(
    'keeps group and dependency references coherent when deleting source=%s',
    (removeSource) => {
      const before = project();
      const result = commit(before, removeSource);
      expect(validateSceneIntegrity(result.project.scene)).toBeNull();
      expect(result.project.scene.groups).toEqual([]);
      expect(result.project.scene.designTreeOrder).toEqual([{ kind: 'object', id: 'text' }]);
      const mask = result.project.scene.objects.find((object) => object.id === 'masked');
      const text = result.project.scene.objects.find((object) => object.id === 'text');
      expect(mask).not.toHaveProperty('imageMaskId');
      expect(text).not.toHaveProperty('pathText');
      expect(mask?.transform).toBe(before.scene.objects[2]?.transform);
      expect(text && 'paths' in text ? text.paths : undefined).toBe(
        before.scene.objects[3] && 'paths' in before.scene.objects[3]
          ? before.scene.objects[3].paths
          : undefined,
      );
      expect(result.dependencyRepairs).toEqual({
        repairedImageMasks: 1,
        repairedPathTextGuides: 1,
      });
      expect(result.undoStack).toEqual([before]);
      const staleGroups = {
        ...result.project,
        scene: { ...result.project.scene, groups: before.scene.groups! },
      };
      expect(prepareProjectForPersistence(staleGroups)).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('dangling id'),
      });
      expect(deserializeProject(serializeProject(staleGroups)).kind).toBe('invalid');
      const saved = prepareProjectForPersistence(result.project);
      expect(saved.kind).toBe('ok');
      if (saved.kind !== 'ok') return;
      expect(deserializeProject(saved.json)).toEqual({ kind: 'ok', project: saved.project });
    },
  );
});
