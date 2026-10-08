import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage, type TextObject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { applyArraySelection } from './array-actions';
import { regenerateRetainedArray } from './retained-array-regeneration';
import { fixtureState } from './variable-array-test-fixture';
import { svgObj } from './test-helpers';

const grid = { kind: 'grid', rows: 1, columns: 2, spacingX: 3, spacingY: 0 } as const;
describe('retained mask and path-text dependencies', () => {
  it('leaves a shared locked source untouched and keeps every instance dependency local after regeneration', () => {
    const before = fixtureState();
    const guide = { ...svgObj('guide', ['#000000']), locked: true };
    const { variableTemplate: _template, ...fixed } = before.project.scene.objects[0] as TextObject;
    const text = {
      ...fixed,
      id: 'label',
      pathText: { guideObjectId: guide.id, offsetMm: 0, reverse: false },
    };
    const outside = { ...text, id: 'outside' };
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'photo',
      source: 'photo.png',
      dataUrl: 'data:image/png;base64,AA==',
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      color: '#000000',
      dither: 'threshold',
      linesPerMm: 5,
      imageMaskId: guide.id,
    };
    const state = {
      ...before,
      selectedObjectId: text.id,
      additionalSelectedIds: new Set([image.id]),
      project: {
        ...before.project,
        scene: { ...before.project.scene, objects: [guide, text, image, outside], groups: [] },
      },
    };
    const created = {
      ...state,
      ...applyArraySelection(state, grid, () => crypto.randomUUID(), undefined, {
        name: 'Masked labels',
      }),
    };
    expect(created.project.scene.objects.find((object) => object.id === guide.id)).toBe(guide);
    expect(created.project.scene.objects.find((object) => object.id === outside.id)).toBe(outside);
    const layout = created.project.arrayLayouts![0]!;
    expect(layout.ownedObjectIds).not.toContain(guide.id);
    const result = regenerateRetainedArray(created, layout, { ...grid, columns: 3 });
    if (!result.ok) throw new Error(result.reason);
    for (const instance of result.project.arrayLayouts![0]!.instances) {
      const map = instance.sourceToObject;
      expect(
        result.project.scene.objects.find((object) => object.id === map['label']),
      ).toMatchObject({ pathText: { guideObjectId: map['guide'] } });
      expect(
        result.project.scene.objects.find((object) => object.id === map['photo']),
      ).toMatchObject({ imageMaskId: map['guide'] });
    }
    expect(result.project.scene.objects.find((object) => object.id === guide.id)).toBe(guide);
    expect(result.project.scene.objects.find((object) => object.id === outside.id)).toBe(outside);
    expect(deserializeProject(serializeProject(result.project)).kind).toBe('ok');
  });
});
