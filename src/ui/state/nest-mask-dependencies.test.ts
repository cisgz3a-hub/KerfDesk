import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { layoutNest } from '../../core/nesting/layout-nest';
import { applyImageMaskToLuma } from '../../core/raster/image-mask';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  combinedBBox,
  transformedBBox,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function maskFixture(): Project {
  const mask: ImportedSvg = {
    kind: 'imported-svg',
    id: 'mask',
    source: 'mask.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 70, y: 40 },
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'image',
    source: 'image.png',
    dataUrl: 'data:image/png;base64,AA==',
    lumaBase64: Buffer.from(new Uint8Array(400)).toString('base64'),
    pixelWidth: 20,
    pixelHeight: 20,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x: 65, y: 35 },
    operationIds: ['image-op'],
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    imageMaskId: 'mask',
  };
  return {
    ...createProject(),
    scene: {
      objects: [image, mask],
      groups: [],
      layers: [
        {
          ...createLayer({ id: 'image-op', color: '#808080', mode: 'image' }),
          linesPerMm: 10,
          ditherAlgorithm: 'threshold',
        },
        createLayer({ id: 'cut', color: '#000000' }),
      ],
    },
  };
}
function sourceBlackPixels(project: Project, id = 'image'): number {
  const image = project.scene.objects.find((object) => object.id === id);
  if (image?.kind !== 'raster-image') throw new Error('Missing regression image');
  const luma = applyImageMaskToLuma({
    image,
    maskObject: project.scene.objects.find((object) => object.id === image.imageMaskId),
    luma: new Uint8Array(400),
    width: 20,
    height: 20,
  });
  return Array.from(luma).filter((value) => value === 0).length;
}
function positiveOutputPower(project: Project, id = 'image'): number {
  return compileJob(project.scene, project.device)
    .groups.flatMap((group) =>
      group.kind === 'raster' && group.sourceObjectId === id ? Array.from(group.sValues) : [],
    )
    .filter((value) => value > 0).length;
}
function select(project: Project, ids: readonly string[]): void {
  useStore.setState({
    project,
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}
const options = { bin: 'workspace', padding: 2, allowRotation: false, method: 'fast' } as const;
beforeEach(resetStore);
describe('rigid image-mask nesting', () => {
  it.each([180, 270] as const)(
    'keeps a masked image rigid through draft acceptance with an explicit %i-degree rotation',
    (angle) => {
      const project = maskFixture();
      select(project, ['image', 'mask']);
      const originalSource = JSON.stringify(project);
      const originalPower = positiveOutputPower(project);
      const draft = useStore.getState().prepareNestSelection({
        ...options,
        allowRotation: true,
        rotationAngles: [angle],
        keepGrain: angle === 180,
        goal: 'compact',
        optimise: true,
      });
      if (!draft.ok) throw new Error(draft.reason);
      expect(draft.units).toHaveLength(1);
      expect(draft.units[0]!.objects.map((object) => object.id)).toEqual(['image', 'mask']);
      expect(useStore.getState().project).toBe(project);
      expect(useStore.getState().undoStack).toEqual([]);
      const layout = layoutNest(draft.input);
      if (layout === null) throw new Error('Expected the connected unit to fit');
      expect(useStore.getState().acceptNestSelection(draft, layout)).toMatchObject({
        ok: true,
        packedUnits: 1,
      });
      const after = useStore.getState().project;
      for (const object of after.scene.objects) expect(object.transform.rotationDeg).toBe(angle);
      expect(sourceBlackPixels(after)).toBe(100);
      expect(positiveOutputPower(after)).toBe(originalPower);
      expect(after.scene.groups).toBe(project.scene.groups);
      expect(after.scene.layers).toBe(project.scene.layers);
      expect(JSON.stringify(project)).toBe(originalSource);
      expect(useStore.getState().undoStack).toEqual([project]);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(project);
    },
  );
  it('moves an ungrouped image and mask as one unit and preserves real raster power', () => {
    const project = maskFixture();
    select(project, ['image', 'mask']);
    const originalSource = JSON.stringify(project);
    expect(sourceBlackPixels(project)).toBe(100);
    expect(positiveOutputPower(project)).toBe(10_000);
    expect(useStore.getState().quickNestSelection(options)).toMatchObject({
      ok: true,
      packedUnits: 1,
    });
    const after = useStore.getState().project;
    expect(sourceBlackPixels(after)).toBe(100);
    expect(positiveOutputPower(after)).toBe(10_000);
    expect(JSON.stringify(project)).toBe(originalSource);
    const [image, mask] = after.scene.objects;
    expect(mask!.transform.x - image!.transform.x).toBe(5);
    expect(mask!.transform.y - image!.transform.y).toBe(5);
    expect(useStore.getState().undoStack).toEqual([project]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
  });
  it.each([['image'], ['mask']])(
    'refuses partial dependency selection %j without changing selected or unselected artwork',
    (id) => {
      const project = maskFixture();
      select(project, [id]);
      expect(useStore.getState().quickNestSelection(options)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/mask/i),
      });
      expect(useStore.getState().project).toBe(project);
      expect(useStore.getState().undoStack).toEqual([]);
      expect(useStore.getState().dirty).toBe(false);
    },
  );
  it.each(['locked', 'hidden'] as const)(
    'refuses a selected %s mask instead of moving only its image',
    (unavailable) => {
      const original = maskFixture();
      const project = {
        ...original,
        scene: {
          ...original.scene,
          objects: original.scene.objects.map((object) =>
            object.id === 'mask' && unavailable === 'locked' ? { ...object, locked: true } : object,
          ),
          layers: original.scene.layers.map((layer) =>
            layer.id === 'cut' && unavailable === 'hidden' ? { ...layer, visible: false } : layer,
          ),
        },
      };
      select(project, ['image', 'mask']);
      expect(useStore.getState().quickNestSelection(options).ok).toBe(false);
      expect(useStore.getState().project).toBe(project);
      expect(useStore.getState().undoStack).toHaveLength(0);
    },
  );
  it('refuses to move a shared mask while another image that uses it is unselected', () => {
    const original = maskFixture(),
      image = original.scene.objects[0] as RasterImage;
    const project = {
      ...original,
      scene: {
        ...original.scene,
        objects: [...original.scene.objects, { ...image, id: 'unselected-image' }],
      },
    };
    select(project, ['image', 'mask']);
    expect(useStore.getState().quickNestSelection(options).ok).toBe(false);
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().project.scene.objects[2]).toBe(project.scene.objects[2]);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
  it('rotates shared-mask images and a grouped companion together without losing source or executable pixels', () => {
    const original = maskFixture(),
      image = original.scene.objects[0] as RasterImage,
      mask = original.scene.objects[1] as ImportedSvg;
    const companion: SceneObject = {
      ...mask,
      id: 'companion',
      transform: { ...mask.transform, x: 60, y: 35 },
    } as ImportedSvg;
    const second = { ...image, id: 'second', transform: { ...image.transform, x: 75 } };
    const shared = { ...mask, transform: { ...mask.transform, x: 75 } };
    const project = {
      ...original,
      workspace: { width: 25, height: 50, units: 'mm' as const },
      scene: {
        ...original.scene,
        objects: [image, shared, second, companion],
        groups: [{ id: 'art-group', name: 'Grouped artwork', objectIds: ['image', 'companion'] }],
      },
    };
    select(project, ['image', 'mask', 'second', 'companion']);
    expect(sourceBlackPixels(project)).toBe(100);
    expect(sourceBlackPixels(project, 'second')).toBe(100);
    expect(
      useStore.getState().quickNestSelection({ ...options, padding: 1, allowRotation: true }),
    ).toMatchObject({ ok: true, packedUnits: 1 });
    const after = useStore.getState().project;
    for (const id of ['image', 'second']) {
      expect(sourceBlackPixels(after, id)).toBe(100);
      expect(positiveOutputPower(after, id)).toBe(positiveOutputPower(project, id));
    }
    for (const object of after.scene.objects) expect(object.transform.rotationDeg).toBe(90);
    const movedImage = after.scene.objects[0]!,
      movedMask = after.scene.objects[1]!;
    expect(movedMask.transform.x - movedImage.transform.x).toBe(-5);
    expect(movedMask.transform.y - movedImage.transform.y).toBe(10);
    expect(after.scene.layers).toBe(project.scene.layers);
    expect(after.scene.groups).toBe(project.scene.groups);
    after.scene.objects.forEach((object, index) => {
      expect(object.operationIds).toBe(project.scene.objects[index]!.operationIds);
      if ('paths' in object && 'paths' in project.scene.objects[index]!)
        expect(object.paths).toBe((project.scene.objects[index] as ImportedSvg).paths);
    });
    expect(useStore.getState().undoStack).toEqual([project]);
  });
  it('does not require an external mask for an image-owned clip', () => {
    const original = maskFixture(),
      image = original.scene.objects[0] as RasterImage;
    const { imageMaskId: _mask, ...plain } = image;
    const project = {
      ...original,
      scene: { ...original.scene, objects: [{ ...plain, imageClip: [] }] },
    };
    select(project, ['image']);
    expect(useStore.getState().quickNestSelection(options)).toMatchObject({
      ok: true,
      packedUnits: 1,
    });
  });
});

describe('rigid nesting component identity', () => {
  it('packs distinct admitted components whose opaque group IDs contain colliding separators', () => {
    const template = maskFixture().scene.objects[1] as ImportedSvg;
    const part = (id: string, x: number, y: number): ImportedSvg => ({
      ...template,
      id,
      transform: { ...IDENTITY_TRANSFORM, x, y },
    });
    const project: Project = {
      ...createProject(),
      workspace: { width: 100, height: 80, units: 'mm' },
      scene: {
        objects: [
          part('A1', 150, 60),
          part('A2', 165, 60),
          part('B1', 150, 100),
          part('B2', 165, 100),
        ],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [
          { id: 'a+b', name: 'First A', objectIds: ['A1', 'A2'] },
          { id: 'c', name: 'Second A', objectIds: ['A1', 'A2'] },
          { id: 'a', name: 'First B', objectIds: ['B1', 'B2'] },
          { id: 'b+c', name: 'Second B', objectIds: ['B1', 'B2'] },
        ],
      },
    };
    const imported = deserializeProject(serializeProject(project));
    expect(imported.kind).toBe('ok');
    if (imported.kind !== 'ok') throw new Error('Invalid collision regression project');
    select(imported.project, ['A1', 'A2', 'B1', 'B2']);
    const originalSource = JSON.stringify(imported.project);
    expect(useStore.getState().quickNestSelection(options)).toMatchObject({
      ok: true,
      packedUnits: 2,
    });
    const after = useStore.getState().project;
    for (const object of after.scene.objects) {
      const box = transformedBBox(object);
      expect(box.minX).toBeGreaterThanOrEqual(0);
      expect(box.minY).toBeGreaterThanOrEqual(0);
      expect(box.maxX).toBeLessThanOrEqual(project.workspace.width);
      expect(box.maxY).toBeLessThanOrEqual(project.workspace.height);
    }
    const a = combinedBBox(after.scene.objects.slice(0, 2))!;
    const b = combinedBBox(after.scene.objects.slice(2))!;
    expect(
      a.maxX + options.padding <= b.minX ||
        b.maxX + options.padding <= a.minX ||
        a.maxY + options.padding <= b.minY ||
        b.maxY + options.padding <= a.minY,
    ).toBe(true);
    for (const start of [0, 2]) {
      const first = after.scene.objects[start]!;
      const second = after.scene.objects[start + 1]!;
      expect(second.transform.x - first.transform.x).toBe(15);
      expect(second.transform.y - first.transform.y).toBe(0);
    }
    expect(after.scene.groups).toBe(imported.project.scene.groups);
    expect(JSON.stringify(imported.project)).toBe(originalSource);
    expect(useStore.getState().undoStack).toEqual([imported.project]);
  });
});
