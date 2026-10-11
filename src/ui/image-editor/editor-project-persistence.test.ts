import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { RgbaBuffer } from '../../core/image-edit';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { cropMaskedRasterImage } from '../raster/crop-image';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { addLayerAboveActive, setActiveLayerProps } from './editor-session-layers';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';
import { useImageEditorStore } from './image-editor-store';
import type { EditorSession } from './editor-session';

vi.mock('./image-editor-decode', () => ({
  bakeBufferToBitmapFields: vi.fn(),
  decodeRasterToBuffer: vi.fn(),
}));

function bitmap(buffer: RgbaBuffer) {
  const rgba = [...buffer.data];
  const luma = rgba.filter((_, index) => index % 4 === 0);
  return {
    dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...rgba))}`,
    lumaBase64: btoa(String.fromCharCode(...luma)),
  };
}

function currentImage(): RasterImage {
  const image = useStore.getState().project.scene.objects[0];
  if (image?.kind !== 'raster-image') throw Error('Expected photo');
  return image;
}

function session(): EditorSession {
  const value = useImageEditorStore.getState().session;
  if (value === null) throw Error('Expected editor session');
  return value;
}

function updateSession(update: (current: EditorSession) => EditorSession) {
  useImageEditorStore.setState({ session: update(session()) });
}

function clearEditorMemory() {
  useImageEditorStore.setState({
    session: null,
    sessionOwner: null,
    stash: {},
    loadState: { kind: 'idle' },
    isApplying: false,
    applyRequest: null,
    pendingCrop: null,
    transform: null,
  });
}

async function openCurrentImage() {
  useImageEditorStore.getState().openEditor(currentImage());
  await vi.waitFor(() => expect(useImageEditorStore.getState().session).not.toBeNull());
}

async function apply() {
  useImageEditorStore.getState().apply();
  await vi.waitFor(() => expect(useImageEditorStore.getState().isApplying).toBe(false));
}

async function addPaintLayer() {
  await openCurrentImage();
  updateSession((current) => {
    const layered = addLayerAboveActive(current, 'paint');
    layered.doc.data.set([19, 29, 39, 80, 99, 88, 77, 0]);
    return setActiveLayerProps(layered, {
      name: 'Fine ink',
      opacity: 0.4,
      blend: 'multiply',
      isVisible: false,
    });
  });
}

beforeEach(() => {
  resetStore();
  clearEditorMemory();
  vi.resetAllMocks();
  const base = createProject();
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: '//8=',
  };
  useStore.getState().setProject({
    ...base,
    scene: {
      ...base.scene,
      objects: [image],
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
    },
  });
  vi.mocked(decodeRasterToBuffer).mockImplementation(async () => createRgbaBuffer(2, 1));
  vi.mocked(bakeBufferToBitmapFields).mockImplementation(async (buffer) => bitmap(buffer));
});

afterEach(() => {
  clearEditorMemory();
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});

describe('photo layers through project persistence and lifecycle', () => {
  it('applies, saves, clears all editor memory, reopens, edits the restored layer and applies again', async () => {
    await addPaintLayer();
    await apply();
    const firstDocument = currentImage().editorDocument;
    expect(firstDocument?.layers).toHaveLength(2);
    const saved = prepareProjectForPersistence(useStore.getState().project);
    expect(saved.kind).toBe('ok');
    if (saved.kind !== 'ok') throw Error(saved.reason);
    const reopened = deserializeProject(saved.json);
    if (reopened.kind !== 'ok') throw Error('Project failed to reopen');
    clearEditorMemory();
    useStore.getState().setProject(reopened.project);
    await openCurrentImage();
    expect(decodeRasterToBuffer).toHaveBeenCalledTimes(1); // Only initial legacy import.
    expect(session().layers).toHaveLength(2);
    expect(session().activeLayerId).toBe('paint');
    expect([...session().doc.data]).toEqual([19, 29, 39, 80, 99, 88, 77, 0]);
    expect(session().history.undoStack).toHaveLength(0);
    updateSession((current) =>
      setActiveLayerProps(current, { name: 'Edited after restart', isVisible: true }),
    );
    await apply();
    const secondDocument = currentImage().editorDocument;
    expect(secondDocument?.layers[1]).toMatchObject({
      name: 'Edited after restart',
      isVisible: true,
      opacity: 0.4,
      blend: 'multiply',
    });
    expect(secondDocument?.layers[1]?.rgbaBase64).toBe(firstDocument?.layers[1]?.rgbaBase64);
    expect(prepareProjectForPersistence(useStore.getState().project).kind).toBe('ok');

    useImageEditorStore.getState().closeEditor();
    useStore.getState().undo();
    expect(currentImage().editorDocument).toEqual(firstDocument);
    await openCurrentImage(); // A stash owned by the second Apply must not override project Undo.
    expect(session().layers[1]).toMatchObject({ name: 'Fine ink', isVisible: false });
    useImageEditorStore.getState().closeEditor();
    useStore.getState().redo();
    await openCurrentImage();
    expect(session().layers[1]).toMatchObject({ name: 'Edited after restart', isVisible: true });
  });

  it('keeps applied source and bitmap from the same revision while newer paint waits unsaved', async () => {
    await openCurrentImage();
    useImageEditorStore.setState({
      tool: { kind: 'pencil' },
      brush: { diameterPx: 1, hardness: 1, opacity: 1 },
      foreground: { r: 0, g: 0, b: 0 },
    });
    useImageEditorStore.getState().stroke([{ x: 0.5, y: 0.5 }]);
    let finish!: () => void;
    vi.mocked(bakeBufferToBitmapFields).mockImplementation((buffer) => {
      const fields = bitmap(buffer); // Mirrors real encoder's synchronous pixel capture.
      return new Promise((resolve) => {
        finish = () => resolve(fields);
      });
    });
    useImageEditorStore.getState().apply();
    useImageEditorStore.setState({ foreground: { r: 100, g: 100, b: 100 } });
    useImageEditorStore.getState().stroke([{ x: 1.5, y: 0.5 }]);
    finish();
    await vi.waitFor(() => expect(useImageEditorStore.getState().isApplying).toBe(false));
    const image = currentImage();
    const appliedRgba = atob(image.editorDocument?.layers[0]?.rgbaBase64 ?? '');
    expect(appliedRgba.charCodeAt(0)).toBe(0);
    expect(appliedRgba.charCodeAt(4)).toBe(255);
    expect(atob(image.lumaBase64 ?? '')).toBe(String.fromCharCode(0, 255));
    expect(session().doc.data[4]).toBe(100);
    expect(session().dirtySinceApply).toBe(true);
  });

  it('clears old editable source for legacy bitmap replacement and restores it with project Undo', async () => {
    await addPaintLayer();
    await apply();
    const document = currentImage().editorDocument;
    useStore.getState().applyEditedImage('photo', {
      dataUrl: 'data:image/png;base64,new',
      lumaBase64: 'AA==',
      pixelWidth: 1,
      pixelHeight: 1,
    });
    expect(currentImage()).not.toHaveProperty('editorDocument');
    expect(prepareProjectForPersistence(useStore.getState().project).kind).toBe('ok');
    useStore.getState().undo();
    expect(currentImage().editorDocument).toEqual(document);
  });

  it('clears retained layers after masked cropping replaces the flattened pixel grid', async () => {
    await addPaintLayer();
    await apply();
    const mask = createRectangle({
      id: 'mask',
      color: '#000000',
      spec: { widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
    });
    const cropped = await cropMaskedRasterImage(
      { ...currentImage(), imageMaskId: mask.id },
      mask,
      (raster) => ({
        dataUrl: 'data:image/png;base64,cropped',
        lumaBase64: btoa(String.fromCharCode(...raster.luma)),
      }),
    );
    expect(cropped.pixelWidth).toBe(1);
    expect(cropped).not.toHaveProperty('editorDocument');
    expect(cropped).not.toHaveProperty('imageMaskId');
  });
});
