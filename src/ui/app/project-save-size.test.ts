import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import type { PhotoEditorDocument } from '../../core/scene/photo-editor-document';
import type { SketchEntity } from '../../core/design/sketch-entity';
import { projectSaveNeedsWorker } from './project-save-size';

function photoProject(lengths: readonly number[]): Project {
  const project = createProject();
  const editorDocument: PhotoEditorDocument = {
    version: 1,
    width: 256,
    height: 256,
    activeLayerId: '0',
    layers: lengths.map((length, index) => ({
      id: String(index),
      name: 'Photo layer',
      isVisible: index === 0,
      opacity: 1,
      blend: 'normal',
      rgbaBase64: 'A'.repeat(length),
    })),
  };
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,small',
    pixelWidth: 256,
    pixelHeight: 256,
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    editorDocument,
  };
  return { ...project, scene: { ...project.scene, objects: [photo] } };
}

function sketchProject(entities: readonly SketchEntity[]): Project {
  return {
    ...createProject(),
    designStudioDocument: {
      version: 1,
      sketch: { entities },
      activeLayerId: 'layer',
      surface3d: false,
      appliedObjectIds: [],
      appliedOperationsByLayer: [],
      appliedEntityObjectIds: [],
    },
  };
}

describe('project save scheduling with editable sources', () => {
  it('counts hidden lossless photo layers even when the flattened PNG is tiny', () => {
    expect(projectSaveNeedsWorker(photoProject([350_000, 350_000]))).toBe(true);
    expect(projectSaveNeedsWorker(photoProject([350_000]))).toBe(false);
  });

  it('combines editable source bytes with other project content', () => {
    expect(projectSaveNeedsWorker({ ...photoProject([350_000]), notes: 'a'.repeat(150_000) })).toBe(
      true,
    );
  });

  it('stops inspecting photo layers once the worker threshold is reached', () => {
    const project = photoProject([500_000, 1]);
    const photo = project.scene.objects[0] as RasterImage;
    Object.defineProperty(photo.editorDocument!.layers[1], 'rgbaBase64', {
      get() {
        throw new Error('must not visit later layers');
      },
    });
    expect(projectSaveNeedsWorker(project)).toBe(true);
  });

  it('counts source-only construction paths without visiting their individual points', () => {
    const points = new Array<{ x: number; y: number }>(5_000);
    Object.defineProperty(points, 0, {
      get() {
        throw new Error('must not traverse source points');
      },
    });
    expect(
      projectSaveNeedsWorker(
        sketchProject([{ id: 'guide', kind: 'path', construction: true, closed: false, points }]),
      ),
    ).toBe(true);
  });

  it('keeps small source drawings synchronous and schedules many exact primitives', () => {
    const line: SketchEntity = {
      id: 'line',
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    };
    expect(projectSaveNeedsWorker(sketchProject([line]))).toBe(false);
    expect(projectSaveNeedsWorker(sketchProject(Array.from({ length: 250 }, () => line)))).toBe(
      true,
    );
  });

  it('routes archived sheets to worker preparation without parsing their editable sources', () => {
    const source = createProject();
    const archived = { id: 'sheet', name: 'Photo', projectJson: '' };
    Object.defineProperty(archived, 'projectJson', {
      get() {
        throw new Error('must not parse archive on the UI thread');
      },
    });
    expect(
      projectSaveNeedsWorker({
        ...source,
        sheetBook: { activeId: 'active', activeName: 'Active', inactive: [archived] },
      }),
    ).toBe(true);
  });
});
