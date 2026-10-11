import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyImageMaskToLuma } from '../../core/raster/image-mask';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
  type TracedImage,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { dependentText } from './testing/scene-clipboard-fixtures';
import { useToastStore } from './toast-store';
import { load, square, trace } from './trace-part.test-support';

const PIXELS = 11;
const LUMA = new Uint8Array(PIXELS * PIXELS).fill(64);

function maskedImage(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'image',
    source: 'image.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: PIXELS,
    pixelHeight: PIXELS,
    bounds: { minX: 0, minY: 0, maxX: 110, maxY: 110 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 1,
    lumaBase64: Buffer.from(LUMA).toString('base64'),
    imageMaskId: 'trace',
  };
}

function loadDependents(dependents: ReadonlyArray<SceneObject>, object = trace()): TracedImage {
  const source = { ...object, transform: IDENTITY_TRANSFORM };
  load(source);
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: [source, ...dependents],
        layers: [
          ...state.project.scene.layers,
          createLayer({ id: 'image', color: '#808080', mode: 'image' }),
          { ...createLayer({ id: 'hidden', color: '#123456' }), visible: false },
        ],
      },
    },
  }));
  return source;
}

function maskedPixels(): Uint8Array {
  const objects = useStore.getState().project.scene.objects;
  const image = objects.find((object) => object.id === 'image');
  if (image?.kind !== 'raster-image') throw new Error('Missing test image');
  return applyImageMaskToLuma({
    image,
    maskObject: objects.find((object) => object.id === image.imageMaskId),
    luma: LUMA,
    width: PIXELS,
    height: PIXELS,
  });
}

function dismissToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

describe('trace part dependency protection', () => {
  beforeEach(() => {
    resetStore();
    dismissToasts();
  });
  afterEach(dismissToasts);

  it('keeps a live raster mask unchanged when picking a contour would remove it from the mask', () => {
    loadDependents([maskedImage()]);
    const before = useStore.getState();
    const pixels = maskedPixels();
    expect(pixels[8 * PIXELS + 8]).toBe(64);
    expect(pixels[2 * PIXELS + 2]).toBe(255);
    const id = useStore.getState().detachTracePart('trace', 0, 2);
    expect(maskedPixels()).toEqual(pixels);
    expect(id).toBeNull();
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().redoStack).toBe(before.redoStack);
    expect(useStore.getState().dirty).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Crop Image');
  });

  it('keeps the complete text guide and saved text geometry intact when a split is refused', () => {
    const text = dependentText('text', 'trace');
    const source = loadDependents([text]);
    const before = useStore.getState();
    expect(useStore.getState().detachTracePart('trace', 0, 0)).toBeNull();
    const after = useStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.project.scene.objects).toEqual([source, text]);
    expect(after.project.scene.objects[1]).toBe(text);
    expect(after.undoStack).toBe(before.undoStack);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Path text');
  });

  it('protects shared hidden and locked dependencies and cancels without an undo entry', () => {
    loadDependents([
      { ...maskedImage(), locked: true, operationIds: ['hidden'] },
      { ...maskedImage(), id: 'second-image', operationIds: ['hidden'] },
      { ...dependentText('text', 'trace'), locked: true, operationIds: ['hidden'] },
    ]);
    useStore.setState({ selectedObjectId: 'text' });
    const before = useStore.getState();
    useStore.getState().beginInteraction();
    expect(useStore.getState().detachTracePart('trace', 0, 2)).toBeNull();
    useStore.getState().cancelInteraction();
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().selectedObjectId).toBe('text');
    expect(useStore.getState().pendingUndo).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Crop Image');
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Path text');
  });

  it('allows selecting and moving an already separate part even when it is a mask and guide', () => {
    const source = loadDependents(
      [maskedImage(), dependentText('text', 'trace')],
      trace([{ color: '#000000', polylines: [square(0)] }]),
    );
    const before = useStore.getState().project;
    expect(useStore.getState().detachTracePart('trace', 0, 0)).toBe('trace');
    expect(useStore.getState().project).toBe(before);
    useStore.getState().selectTracePart('trace');
    useStore.getState().setObjectTransform('trace', { ...source.transform, x: 15 });
    expect(useStore.getState().selectedObjectId).toBe('trace');
    expect(useStore.getState().project.scene.objects[0]?.transform.x).toBe(15);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does not block a split because unrelated artwork has mask or path text dependents', () => {
    const image = { ...maskedImage(), imageMaskId: 'other' };
    const text = dependentText('text', 'other');
    loadDependents([{ ...trace(), id: 'other' }, image, text]);
    expect(useStore.getState().detachTracePart('trace', 0, 2)).toBe('trace__part_1');
    expect(useStore.getState().project.scene.objects).toContain(image);
    expect(useStore.getState().project.scene.objects).toContain(text);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it.each(['crop', 'remove'] as const)(
    'allows splitting after explicitly releasing a mask with %s, with separate undo steps',
    (method) => {
      const image = maskedImage();
      loadDependents([image]);
      const before = useStore.getState().project;
      expect(useStore.getState().detachTracePart('trace', 0, 2)).toBeNull();
      const baked = Buffer.from(maskedPixels()).toString('base64');
      if (method === 'crop') {
        useStore.getState().cropImage('image', { ...image, lumaBase64: baked });
      } else {
        useStore.getState().removeImageMask('image');
      }
      const released = useStore.getState().project;
      expect(useStore.getState().detachTracePart('trace', 0, 2)).toBe('trace__part_1');
      expect(
        useStore.getState().project.scene.objects.find((object) => object.id === 'image'),
      ).toMatchObject({ lumaBase64: method === 'crop' ? baked : image.lumaBase64 });
      expect(useStore.getState().undoStack).toHaveLength(2);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(released);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before);
    },
  );

  it('allows splitting after the text dialog saves with Path text disabled', () => {
    const text = dependentText('text', 'trace');
    loadDependents([text]);
    expect(useStore.getState().detachTracePart('trace', 0, 0)).toBeNull();
    const { pathText: _pathText, ...releasedText } = text;
    useStore.getState().upsertTextObject(releasedText);
    expect(useStore.getState().detachTracePart('trace', 0, 0)).toBe('trace__part_1');
    const saved = useStore.getState().project.scene.objects.find((object) => object.id === 'text');
    expect(saved?.kind === 'text' ? saved.pathText : 'missing').toBeUndefined();
  });
});
