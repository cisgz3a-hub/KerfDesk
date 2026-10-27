import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { runPreflight } from '../../core/preflight';
import {
  createLayer,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives';
import { lumaToBase64 } from '../raster/luma-bitmap';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// Rolling audit v4 H5-P1-1 (ADR-633 Amendment 2): Centre + copy gave every
// copy of a masked photo the first outline's mask, so outlines 2 and 3 burned
// nothing while the canvas drew all three photos.

const PIXELS = 40;

function photo(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,portrait',
    pixelWidth: PIXELS,
    pixelHeight: PIXELS,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 },
    color: '#808080',
    operationIds: ['photo-op'],
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: lumaToBase64(new Uint8Array(PIXELS * PIXELS).fill(40)),
  };
}

// A 40 mm circle over the photo, on a visible Line operation that does not output.
function circle(): SceneObject {
  return createEllipse({
    id: 'mask',
    color: '#000000',
    spec: { widthMm: 40, heightMm: 40 },
    transform: IDENTITY_TRANSFORM,
  });
}

function setUpMaskedPhotoInJig(): void {
  useStore.getState().replaceRegistrationJigSet({
    outline: { kind: 'rectangle', widthMm: 50, heightMm: 50 },
    rows: 1,
    columns: 3,
    spacingX: 10,
    spacingY: 0,
  });
  const { project } = useStore.getState();
  useStore.getState().setProject({
    ...project,
    scene: {
      ...project.scene,
      objects: [...project.scene.objects, photo(), circle()],
      layers: [
        ...project.scene.layers,
        { ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }), linesPerMm: 1 },
        { ...createLayer({ id: 'mask-op', color: '#000000', mode: 'line' }), output: false },
      ],
    },
  });
  useStore.getState().applyImageMask('photo', 'mask');
}

function select(ids: ReadonlyArray<string>): void {
  const [first, ...rest] = ids;
  useStore.setState({ selectedObjectId: first ?? null, additionalSelectedIds: new Set(rest) });
}

/** Burned cells of each photo's raster group, left to right. */
function burnedCellsPerPhoto(): ReadonlyArray<number> {
  const { project } = useStore.getState();
  const photos = project.scene.objects.filter((object) => object.kind === 'raster-image');
  const groups = compileJob(project.scene, project.device).groups;
  return photos
    .map((object) => {
      const group = groups.find(
        (candidate) => candidate.kind === 'raster' && candidate.sourceObjectId === object.id,
      );
      const values = group?.kind === 'raster' ? group.sValues : [];
      return { x: transformedBBox(object).minX, burned: values.filter((s) => s > 0).length };
    })
    .sort((a, b) => a.x - b.x)
    .map((entry) => entry.burned);
}

function maskOf(object: SceneObject | undefined): SceneObject | undefined {
  if (object?.kind !== 'raster-image') return undefined;
  const { objects } = useStore.getState().project.scene;
  return objects.find((candidate) => candidate.id === object.imageMaskId);
}

describe('jig Centre + copy with a masked photo (ADR-633 Amendment 2)', () => {
  beforeEach(() => {
    resetStore();
    setUpMaskedPhotoInJig();
  });

  it.each([
    ['the photo and its mask', ['photo', 'mask']],
    ['only the photo', ['photo']],
  ])('burns the photo in every outline when %s is selected', (_label, selection) => {
    select(selection);
    useStore.getState().centerSelectionInRegistrationBox();

    const burned = burnedCellsPerPhoto();
    expect(burned).toHaveLength(3);
    expect(burned[0]).toBeGreaterThan(0);
    expect(burned).toEqual([burned[0], burned[0], burned[0]]);
  });

  it('gives each outline its own copy of the mask, inside that outline', () => {
    select(['photo']);
    useStore.getState().centerSelectionInRegistrationBox();

    const { scene } = useStore.getState().project;
    const boxes = findRegistrationBoxes(scene);
    const photos = scene.objects.filter((object) => object.kind === 'raster-image');
    expect(photos).toHaveLength(3);
    const masks = photos.map(maskOf);
    expect(new Set(masks.map((mask) => mask?.id)).size).toBe(3);
    for (const [index, mask] of masks.entries()) {
      const box = boxes.find((candidate) => candidate.id === photos[index]?.registrationJig?.boxId);
      if (mask === undefined || box === undefined) throw new Error('mask or outline missing');
      expect(mask.registrationJig?.boxId).toBe(box.id);
      const outline = transformedBBox(box);
      const shape = transformedBBox(mask);
      expect(shape.minX).toBeGreaterThanOrEqual(outline.minX);
      expect(shape.maxX).toBeLessThanOrEqual(outline.maxX);
    }
  });

  it('refreshes the mask copies instead of adding more on a second click', () => {
    select(['photo']);
    useStore.getState().centerSelectionInRegistrationBox();
    const first = useStore.getState().project.scene.objects.map((object) => object.id);

    select(['photo']);
    useStore.getState().centerSelectionInRegistrationBox();

    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(first);
    expect(burnedCellsPerPhoto()).toHaveLength(3);
  });
});

describe('Job Review names a mask that misses its photo (ADR-633 Amendment 2)', () => {
  beforeEach(() => {
    resetStore();
    setUpMaskedPhotoInJig();
  });

  function offImageIssues(): ReadonlyArray<string> {
    const { project } = useStore.getState();
    return runPreflight(project, 'G1 X1 S1')
      .issues.filter((issue) => issue.code === 'image-mask-off-image')
      .map((issue) => issue.message);
  }

  it('warns when the mask lies wholly off the photo', () => {
    select(['mask']);
    useStore.getState().centerSelectionInRegistrationBox();

    const messages = offImageIssues();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"portrait.png"');
    expect(messages[0]).toContain('Remove Image Mask');
  });

  it('says nothing while every mask reaches its photo', () => {
    expect(offImageIssues()).toEqual([]);
    select(['photo']);
    useStore.getState().centerSelectionInRegistrationBox();
    expect(offImageIssues()).toEqual([]);
  });
});
