import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TextObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

function maskedProject(grouped = false): Project {
  const base = createProject();
  const mask = {
    ...createRectangle({
      id: 'mask',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    operationIds: ['mask-op'],
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'image',
    source: 'image.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    operationIds: ['image-op'],
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
    imageMaskId: 'mask',
  };
  return {
    ...base,
    scene: {
      objects: [mask, image],
      layers: [
        createLayer({ id: 'mask-op', color: '#000000' }),
        createLayer({ id: 'image-op', color: '#808080', mode: 'image' }),
      ],
      ...(grouped
        ? { groups: [{ id: 'group', name: 'Masked image', objectIds: ['mask', 'image'] }] }
        : {}),
    },
  };
}

beforeEach(() => {
  resetStore();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

describe('scene dependency closure', () => {
  it('copies and pastes a raster mask dependency with remapped identity', () => {
    useStore.setState({ project: maskedProject(), selectedObjectId: 'image' });
    useStore.getState().copySelection();
    expect(useStore.getState().sceneClipboard?.objects.map((object) => object.id)).toEqual([
      'mask',
      'image',
    ]);
    useStore.setState({ project: createProject(), selectedObjectId: null });

    useStore.getState().pasteClipboard();

    const objects = useStore.getState().project.scene.objects;
    const image = objects.find((object) => object.kind === 'raster-image');
    expect(image?.kind).toBe('raster-image');
    if (image?.kind !== 'raster-image') return;
    expect(image.imageMaskId).not.toBe('mask');
    expect(objects.some((object) => object.id === image.imageMaskId)).toBe(true);
  });

  it('preserves a copied group and remaps all member ids', () => {
    useStore.setState({ project: maskedProject(true), selectedObjectId: 'image' });
    useStore.getState().copySelection();
    useStore.setState({ project: createProject(), selectedObjectId: null });

    useStore.getState().pasteClipboard();

    const state = useStore.getState();
    expect(state.project.scene.groups).toHaveLength(1);
    expect(state.project.scene.groups?.[0]?.objectIds).toHaveLength(2);
    expect(
      state.project.scene.groups?.[0]?.objectIds.every((id) =>
        state.project.scene.objects.some((object) => object.id === id),
      ),
    ).toBe(true);
  });

  it('duplicates masks and groups while preserving masked output references', () => {
    useStore.setState({ project: maskedProject(true), selectedObjectId: 'image' });

    useStore.getState().duplicateSelection();

    const state = useStore.getState();
    const clonedImage = state.project.scene.objects.find(
      (object) => object.kind === 'raster-image' && object.id !== 'image',
    );
    expect(clonedImage?.kind).toBe('raster-image');
    if (clonedImage?.kind !== 'raster-image') return;
    expect(clonedImage.imageMaskId).not.toBe('mask');
    expect(
      state.project.scene.objects.some((object) => object.id === clonedImage.imageMaskId),
    ).toBe(true);
    expect(state.project.scene.groups).toHaveLength(2);
  });

  it('copies and duplicates path-text with a remapped guide dependency', () => {
    const base = createProject();
    const guide = {
      ...createRectangle({
        id: 'guide',
        color: '#000000',
        spec: { widthMm: 20, heightMm: 5, cornerRadiusMm: 0 },
      }),
      operationIds: ['guide-op'],
    };
    const text: TextObject = {
      kind: 'text',
      id: 'path-text',
      content: 'Curve',
      fontKey: 'Roboto',
      sizeMm: 5,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#000000',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
      pathText: { guideObjectId: 'guide', offsetMm: 0, reverse: false },
      operationIds: ['text-op'],
    };
    useStore.setState({
      project: {
        ...base,
        scene: {
          objects: [guide, text],
          layers: [
            createLayer({ id: 'guide-op', color: '#000000' }),
            createLayer({ id: 'text-op', color: '#123456' }),
          ],
        },
      },
      selectedObjectId: 'path-text',
    });

    useStore.getState().duplicateSelection();

    const objects = useStore.getState().project.scene.objects;
    const clone = objects.find((object) => object.kind === 'text' && object.id !== 'path-text');
    expect(clone?.kind).toBe('text');
    if (clone?.kind !== 'text') return;
    expect(clone.pathText?.guideObjectId).not.toBe('guide');
    expect(objects.some((object) => object.id === clone.pathText?.guideObjectId)).toBe(true);
  });

  it('repairs a dangling image mask on delete and surfaces a nonblocking warning', () => {
    useStore.setState({ project: maskedProject(), selectedObjectId: 'mask' });

    useStore.getState().removeSceneObject('mask');

    const image = useStore.getState().project.scene.objects[0];
    expect(image?.kind).toBe('raster-image');
    if (image?.kind !== 'raster-image') return;
    expect(image.imageMaskId).toBeUndefined();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
  });
});
