import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../core/design/layers';
import {
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { applyDesignSketch } from './design-apply-mutation';
import type { DesignApplyRecord } from './design-apply-record';
import { applyFreshImport } from './scene-mutations';

const sketch: Sketch = {
  entities: [
    {
      id: 'drawn',
      kind: 'rect',
      origin: { x: 5, y: 5 },
      widthMm: 20,
      heightMm: 10,
      cornerRadiusMm: 0,
    },
  ],
  layers: [DEFAULT_DESIGN_LAYER],
};

const photo: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  pixelWidth: 4,
  pixelHeight: 4,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};

function apply(project: Project, previous: DesignApplyRecord | null = null, drawing = sketch) {
  const result = applyDesignSketch({ project, undoStack: [] }, drawing, ['vector'], previous);
  if (result === null) throw new Error('Expected a design apply');
  return result;
}

function expectValidRoundTrip(project: Project): void {
  const colors = project.scene.layers.map((layer) => layer.color.toLowerCase());
  expect(new Set(colors).size).toBe(colors.length);
  const reopened = deserializeProject(serializeProject(project));
  expect(reopened.kind).toBe('ok');
  if (reopened.kind !== 'ok') return;
  expect(reopened.project.scene.layers).toEqual(project.scene.layers);
}

describe('Design Studio and photo operation allocation', () => {
  it.each(['photo first', 'design first'] as const)(
    'saves and reopens with independent operations: %s',
    (order) => {
      const blank = createProject();
      const imported = applyFreshImport({ project: blank, undoStack: [] }, photo, 0).project;
      const designed = apply(order === 'photo first' ? imported : blank);
      const combined =
        order === 'photo first'
          ? designed.project
          : applyFreshImport({ project: designed.project, undoStack: [] }, photo, 0).project;
      expectValidRoundTrip(combined);
      const raster = combined.scene.objects.find((object) => object.id === photo.id);
      const vector = combined.scene.objects.find((object) => object.id === 'vector');
      if (raster === undefined || vector === undefined) throw new Error('Expected both artworks');
      const [imageOperationId] = operationIdsForObject(raster, combined.scene.layers);
      const [vectorOperationId] = operationIdsForObject(vector, combined.scene.layers);
      expect(imageOperationId).not.toBe(vectorOperationId);
      expect(combined.scene.layers.find((layer) => layer.id === imageOperationId)?.mode).toBe(
        'image',
      );
      expect(combined.scene.layers.find((layer) => layer.id === vectorOperationId)?.mode).toBe(
        'line',
      );
      const again = apply(combined, designed.applyRecord);
      expectValidRoundTrip(again.project);
      expect(again.project.scene.layers).toEqual(combined.scene.layers);
      expect(again.project.scene.objects).toHaveLength(2);
    },
  );

  it('preserves image settings and reuses a previously allocated fallback color on reapply', () => {
    const imported = applyFreshImport(
      { project: createProject(), undoStack: [] },
      photo,
      0,
    ).project;
    const project = {
      ...imported,
      scene: {
        ...imported.scene,
        layers: imported.scene.layers.map((layer) => ({
          ...layer,
          output: false,
          speed: 1234,
          power: 23,
        })),
      },
    };
    const first = apply(project);
    const imageLayer = first.project.scene.layers[0];
    const vectorLayer = first.project.scene.layers[1];
    expect(imageLayer).toBe(project.scene.layers[0]);
    const again = apply(first.project, first.applyRecord);
    expect(again.project.scene.layers[0]).toBe(imageLayer);
    expect(again.project.scene.layers[1]).toEqual(vectorLayer);
    expect(again.undoStack).toEqual([first.project]);
    expectValidRoundTrip(again.project);
  });

  it('does not duplicate a different operation color when a reused design layer is recolored', () => {
    const first = apply(createProject());
    const imported = applyFreshImport({ project: first.project, undoStack: [] }, photo, 0).project;
    const imageLayer = imported.scene.layers.find((layer) => layer.mode === 'image');
    if (imageLayer === undefined) throw new Error('Expected image operation');
    const recolored = { ...sketch, layers: [{ ...DEFAULT_DESIGN_LAYER, color: imageLayer.color }] };
    const result = apply(imported, first.applyRecord, recolored);
    expect(result.project.scene.layers.find((layer) => layer.mode === 'image')).toBe(imageLayer);
    expect(result.project.scene.layers[0]?.id).toBe(first.project.scene.layers[0]?.id);
    expectValidRoundTrip(result.project);
  });
});
