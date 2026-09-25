import { beforeEach, describe, expect, it } from 'vitest';
import { ownedClipImage, ownedClipProject } from '../../__fixtures__/owned-image-clip';
import { compileJob } from '../../core/job';
import { createImageMaskPixelTest } from '../../core/raster/image-mask';
import { createProject, type ArraySpec, type RasterImage } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => resetStore());

function selectImage(): RasterImage {
  const image = ownedClipImage();
  useStore.setState({ project: ownedClipProject(image), selectedObjectId: image.id });
  return image;
}

function expectClipRetained(image: RasterImage, source: RasterImage): void {
  expect(image.imageClip).toEqual(source.imageClip);
  expect(image.dataUrl).toBe(source.dataUrl);
  expect(image.lumaBase64).toBe(source.lumaBase64);
  expect(image.imageMaskId).toBeUndefined();
  const includes = createImageMaskPixelTest(image, null, 4, 4);
  expect(includes?.(0, 0)).toBe(true);
  expect(includes?.(1, 1)).toBe(false);
  expect(includes?.(3, 0)).toBe(false);
}

describe('owned image clips across scene copies', () => {
  it('copies and pastes the owned geometry and pixels as one object with one undo', () => {
    const source = selectImage();
    useStore.getState().copySelection();
    expect(useStore.getState().sceneClipboard?.objects).toHaveLength(1);
    const destination = createProject();
    useStore.setState({
      project: destination,
      selectedObjectId: null,
      undoStack: [],
      redoStack: [],
    });
    useStore.getState().pasteClipboard();
    const pastedProject = useStore.getState().project;
    expect(pastedProject.scene.objects).toHaveLength(1);
    expect(pastedProject.scene.layers).toHaveLength(1);
    const copied = pastedProject.scene.objects[0];
    if (copied?.kind !== 'raster-image') throw Error('Expected copied image.');
    expect(copied.id).not.toBe(source.id);
    expect(copied.imageClip).not.toBe(source.imageClip);
    expect(copied.svgImport).toBeUndefined();
    expectClipRetained(copied, source);
    expect(compileJob(pastedProject.scene, pastedProject.device).groups).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(destination);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(pastedProject);
  });

  it.each([
    { kind: 'grid', rows: 1, columns: 3, spacingX: 5, spacingY: 0 },
    { kind: 'point-rotation', count: 3, totalAngleDeg: 270 },
    {
      kind: 'circular',
      count: 3,
      centerX: 100,
      centerY: 100,
      radius: 10,
      startAngleDeg: 0,
      rotateCopies: true,
    },
  ] satisfies readonly ArraySpec[])(
    'retains clips through a $kind array without mask helpers',
    (spec) => {
      const source = selectImage(),
        original = useStore.getState().project;
      useStore.getState().arraySelection(spec);
      const array = useStore.getState().project;
      expect(array.scene.objects).toHaveLength(3);
      expect(array.scene.layers).toHaveLength(1);
      expect(new Set(array.scene.objects.map((object) => object.id)).size).toBe(3);
      for (const object of array.scene.objects) {
        if (object.kind !== 'raster-image') throw Error('Unexpected helper artwork.');
        expectClipRetained(object, source);
        if (object.id !== source.id) {
          expect(object.imageClip).not.toBe(source.imageClip);
          expect(object.svgImport).toBeUndefined();
        } else {
          expect(object.svgImport).toEqual(source.svgImport);
          if (spec.kind === 'circular') expect(object.transform).not.toEqual(source.transform);
        }
      }
      if (spec.kind === 'point-rotation')
        expect(array.scene.objects.map((object) => object.transform.rotationDeg)).toEqual([
          0, 90, 180,
        ]);
      expect(compileJob(array.scene, array.device).groups).toHaveLength(3);
      expect(useStore.getState().undoStack).toHaveLength(1);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(original);
      useStore.getState().redo();
      expect(useStore.getState().project).toBe(array);
    },
  );
});
