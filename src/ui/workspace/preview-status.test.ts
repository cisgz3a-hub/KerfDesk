import { describe, expect, it } from 'vitest';
import { buildToolpath, EMPTY_JOB } from '../../core/job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { hasOutOfBoundsObjects } from './out-of-bounds';
import { previewHasBurnableContent } from './preview-status';

const emptyToolpath = buildToolpath(EMPTY_JOB);

function rasterObject(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    ...overrides,
  } as SceneObject;
}

function projectWith(scene: Partial<Project['scene']>): Project {
  return { ...createProject(), scene: { ...EMPTY_SCENE, ...scene } };
}

// M27 (AUDIT-2026-06-10): the scrubber toolpath has no steps for raster
// groups, so totalLength alone would call an image-only job "empty".
describe('previewHasBurnableContent', () => {
  it('is false for an empty scene', () => {
    expect(previewHasBurnableContent(projectWith({}), emptyToolpath)).toBe(false);
  });

  it('is true when the vector toolpath has length', () => {
    const toolpath = {
      steps: [
        {
          kind: 'cut' as const,
          color: '#000000',
          polyline: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          length: 10,
        },
      ],
      totalLength: 10,
    };
    expect(previewHasBurnableContent(projectWith({}), toolpath)).toBe(true);
  });

  it('is true for a raster-only job (no vector steps, but the sim renders)', () => {
    const project = projectWith({
      objects: [rasterObject()],
      layers: [createLayer({ id: 'img', color: '#808080', mode: 'image' })],
    });
    expect(previewHasBurnableContent(project, emptyToolpath)).toBe(true);
  });

  it('ignores trace-source backings and output-disabled image layers', () => {
    const offLayer = {
      ...createLayer({ id: 'img', color: '#808080', mode: 'image' }),
      output: false,
    };
    const project = projectWith({
      objects: [rasterObject()],
      layers: [offLayer],
    });
    expect(previewHasBurnableContent(project, emptyToolpath)).toBe(false);

    const traceSource = projectWith({
      objects: [rasterObject({ role: 'trace-source' } as Partial<SceneObject>)],
      layers: [createLayer({ id: 'img', color: '#808080', mode: 'image' })],
    });
    expect(previewHasBurnableContent(traceSource, emptyToolpath)).toBe(false);
  });
});

describe('hasOutOfBoundsObjects', () => {
  it('flags an object whose transformed bbox leaves the bed', () => {
    const offBed = rasterObject({
      transform: { ...IDENTITY_TRANSFORM, x: -20 },
    } as Partial<SceneObject>);
    const project = projectWith({
      objects: [offBed],
      layers: [createLayer({ id: 'img', color: '#808080', mode: 'image' })],
    });
    expect(hasOutOfBoundsObjects(project)).toBe(true);
  });

  it('is quiet when everything fits', () => {
    const project = projectWith({
      objects: [rasterObject()],
      layers: [createLayer({ id: 'img', color: '#808080', mode: 'image' })],
    });
    expect(hasOutOfBoundsObjects(project)).toBe(false);
  });
});
