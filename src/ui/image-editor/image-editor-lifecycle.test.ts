import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaBuffer } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { createSession, type EditorSession } from './editor-session';
import { commitImageSize } from './editor-session-resize';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';
import { useImageEditorStore } from './image-editor-store';

vi.mock('./image-editor-decode', () => ({
  bakeBufferToBitmapFields: vi.fn(),
  decodeRasterToBuffer: vi.fn(),
}));

const BOUNDS = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
const ORIGINAL_APPLY_EDITED_IMAGE = useStore.getState().applyEditedImage;

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

function projectWithRaster(image: RasterImage): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [image] } };
}

function setCurrentImages(...images: ReadonlyArray<RasterImage>): void {
  const project = createProject();
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: images } },
    projectDocumentEpoch: 1,
  });
}

function session(id: string, revision = 0, dirtySinceApply = false): EditorSession {
  return {
    ...createSession(id, `${id}.png`, createRgbaBuffer(4, 4), BOUNDS),
    revision,
    dirtySinceApply,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetStore();
  vi.mocked(decodeRasterToBuffer).mockReset();
  vi.mocked(bakeBufferToBitmapFields).mockReset();
  useStore.setState({ applyEditedImage: vi.fn() });
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
});

afterEach(() => {
  useStore.setState({ applyEditedImage: ORIGINAL_APPLY_EDITED_IMAGE });
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

describe('Image Studio session lifecycle', () => {
  it('can Apply, Undo, Apply, Redo, and Apply without losing editor changes', async () => {
    const image = raster('editable');
    const snapshots: number[] = [];
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    vi.mocked(bakeBufferToBitmapFields).mockImplementation(async (doc) => {
      const value = doc.data[0] ?? 0;
      snapshots.push(value);
      return {
        dataUrl: `data:image/png;base64,${btoa(String(value))}`,
        lumaBase64: btoa(String.fromCharCode(value).repeat(16)),
      };
    });
    useStore.setState({
      project: projectWithRaster(image),
      projectDocumentEpoch: 5,
      applyEditedImage: ORIGINAL_APPLY_EDITED_IMAGE,
    });
    useImageEditorStore.getState().openEditor(image);
    await settle();
    useImageEditorStore.setState({
      tool: { kind: 'pencil' },
      brush: { diameterPx: 3, hardness: 1, opacity: 1 },
      foreground: { r: 0, g: 0, b: 0 },
    });
    useImageEditorStore.getState().stroke([{ x: 0, y: 0 }]);
    useImageEditorStore.getState().apply();
    await settle();
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(false);

    useImageEditorStore.getState().undo();
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(true);
    useImageEditorStore.getState().apply();
    await settle();
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(false);

    useImageEditorStore.getState().redo();
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(true);
    useImageEditorStore.getState().apply();
    await settle();
    expect(snapshots).toEqual([0, 255, 0]);
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(false);
    const edited = useStore.getState().project.scene.objects[0];
    expect(edited).toMatchObject({ lumaBase64: btoa(String.fromCharCode(0).repeat(16)) });
    expect(useStore.getState().undoStack).toHaveLength(3);
  });

  it('ignores stale decode success after a newer image open starts', async () => {
    const older = deferred<RgbaBuffer>();
    const newer = deferred<RgbaBuffer>();
    vi.mocked(decodeRasterToBuffer).mockImplementation((image) =>
      image.id === 'older' ? older.promise : newer.promise,
    );
    const olderImage = raster('older');
    const newerImage = raster('newer');
    setCurrentImages(olderImage, newerImage);

    useImageEditorStore.getState().openEditor(olderImage);
    useImageEditorStore.getState().openEditor(newerImage);
    older.resolve(createRgbaBuffer(2, 2));
    await settle();

    expect(useImageEditorStore.getState().session).toBeNull();
    expect(useImageEditorStore.getState().loadState).toMatchObject({
      kind: 'loading',
      objectId: 'newer',
    });

    newer.resolve(createRgbaBuffer(4, 4));
    await settle();

    expect(useImageEditorStore.getState().session?.objectId).toBe('newer');
    expect(useImageEditorStore.getState().loadState).toEqual({ kind: 'idle' });
  });

  it('ignores stale decode failure after a newer image open wins', async () => {
    const older = deferred<RgbaBuffer>();
    const newer = deferred<RgbaBuffer>();
    vi.mocked(decodeRasterToBuffer).mockImplementation((image) =>
      image.id === 'older' ? older.promise : newer.promise,
    );
    const olderImage = raster('older');
    const newerImage = raster('newer');
    setCurrentImages(olderImage, newerImage);

    useImageEditorStore.getState().openEditor(olderImage);
    useImageEditorStore.getState().openEditor(newerImage);
    newer.resolve(createRgbaBuffer(4, 4));
    await settle();
    older.reject(new Error('stale decode failed'));
    await settle();

    expect(useImageEditorStore.getState().session?.objectId).toBe('newer');
    expect(useImageEditorStore.getState().loadState).toEqual({ kind: 'idle' });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('reuses the in-flight decode when the same image opens twice', async () => {
    const pending = deferred<RgbaBuffer>();
    vi.mocked(decodeRasterToBuffer).mockReturnValue(pending.promise);
    const image = raster('same');
    setCurrentImages(image);

    useImageEditorStore.getState().openEditor(image);
    useImageEditorStore.getState().openEditor(image);

    expect(decodeRasterToBuffer).toHaveBeenCalledOnce();
    pending.resolve(createRgbaBuffer(4, 4));
    await settle();
    expect(useImageEditorStore.getState().session?.objectId).toBe('same');
  });

  it('does not resume a same-id stashed session after the project document is replaced', async () => {
    const imageA = raster('persisted-image-id');
    const imageB = { ...raster('persisted-image-id'), source: 'project-b.png' };
    const docA = createRgbaBuffer(4, 4);
    const docB = createRgbaBuffer(4, 4);
    vi.mocked(decodeRasterToBuffer).mockResolvedValueOnce(docA).mockResolvedValueOnce(docB);
    useStore.setState({ project: projectWithRaster(imageA), projectDocumentEpoch: 7 });

    useImageEditorStore.getState().openEditor(imageA);
    await settle();
    useImageEditorStore.setState((state) => ({
      session:
        state.session === null ? null : { ...state.session, revision: 7, dirtySinceApply: true },
    }));
    useImageEditorStore.getState().closeEditor();

    useStore.setState({ project: projectWithRaster(imageB), projectDocumentEpoch: 8 });
    useImageEditorStore.getState().openEditor(imageB);
    await settle();

    expect(decodeRasterToBuffer).toHaveBeenCalledTimes(2);
    expect(useImageEditorStore.getState().session?.sourceName).toBe('project-b.png');
    expect(useImageEditorStore.getState().session?.doc).toBe(docB);
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(false);
  });

  it('resumes a stashed session only while the same project image still owns the id', async () => {
    const image = raster('same-document-image');
    const doc = createRgbaBuffer(4, 4);
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(doc);
    useStore.setState({ project: projectWithRaster(image), projectDocumentEpoch: 9 });

    useImageEditorStore.getState().openEditor(image);
    await settle();
    useImageEditorStore.setState((state) => ({
      session:
        state.session === null ? null : { ...state.session, revision: 3, dirtySinceApply: true },
    }));
    useImageEditorStore.getState().closeEditor();
    useImageEditorStore.getState().openEditor(image);

    expect(decodeRasterToBuffer).toHaveBeenCalledOnce();
    expect(useImageEditorStore.getState().session?.doc).toBe(doc);
    expect(useImageEditorStore.getState().session?.revision).toBe(3);
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(true);
  });

  it('does not publish an Apply completion into a replacement project with the same object id', async () => {
    const imageA = raster('persisted-image-id');
    const imageB = { ...raster('persisted-image-id'), source: 'project-b.png' };
    const bake = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    const applyEditedImage = vi.fn();
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    vi.mocked(bakeBufferToBitmapFields).mockReturnValue(bake.promise);
    useStore.setState({
      project: projectWithRaster(imageA),
      projectDocumentEpoch: 11,
      applyEditedImage,
    });
    useImageEditorStore.getState().openEditor(imageA);
    await settle();
    useImageEditorStore.setState((state) => ({
      session:
        state.session === null ? null : { ...state.session, revision: 1, dirtySinceApply: true },
    }));

    useImageEditorStore.getState().apply();
    // An immutable edit/undo can replace the source object without replacing
    // the whole project document, so identity must be checked as well as epoch.
    useStore.setState({ project: projectWithRaster(imageB), projectDocumentEpoch: 11 });
    bake.resolve({ dataUrl: 'data:image/png;base64,stale', lumaBase64: 'AAA=' });
    await settle();

    expect(applyEditedImage).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does not report a stale Apply failure after its source object is replaced', async () => {
    const imageA = raster('persisted-image-id');
    const imageB = { ...raster('persisted-image-id'), source: 'replacement.png' };
    const bake = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    vi.mocked(bakeBufferToBitmapFields).mockReturnValue(bake.promise);
    useStore.setState({ project: projectWithRaster(imageA), projectDocumentEpoch: 13 });
    useImageEditorStore.getState().openEditor(imageA);
    await settle();
    useImageEditorStore.setState((state) => ({
      session:
        state.session === null ? null : { ...state.session, revision: 1, dirtySinceApply: true },
    }));

    useImageEditorStore.getState().apply();
    useStore.setState({ project: projectWithRaster(imageB), projectDocumentEpoch: 13 });
    bake.reject(new Error('stale bake failure'));
    await settle();

    expect(useImageEditorStore.getState().isApplying).toBe(false);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('ignores a decode completion after the editor closes', async () => {
    const pending = deferred<RgbaBuffer>();
    vi.mocked(decodeRasterToBuffer).mockReturnValue(pending.promise);
    const image = raster('closing');
    setCurrentImages(image);

    useImageEditorStore.getState().openEditor(image);
    useImageEditorStore.getState().closeEditor();
    pending.resolve(createRgbaBuffer(4, 4));
    await settle();

    expect(useImageEditorStore.getState().session).toBeNull();
    expect(useImageEditorStore.getState().loadState).toEqual({ kind: 'idle' });
  });

  it('keeps Apply completion bound to its object and starting revision across Close', async () => {
    const bake = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    vi.mocked(bakeBufferToBitmapFields).mockReturnValue(bake.promise);
    useImageEditorStore.setState({ session: session('older', 3, true) });

    useImageEditorStore.getState().apply();
    useImageEditorStore.getState().closeEditor();
    useImageEditorStore.setState({ session: session('newer', 1, true) });
    bake.resolve({ dataUrl: 'data:image/png;base64,edited', lumaBase64: 'AAA=' });
    await settle();

    const state = useImageEditorStore.getState();
    expect(state.session?.objectId).toBe('newer');
    expect(state.session?.dirtySinceApply).toBe(true);
    expect(state.stash['older']?.session.dirtySinceApply).toBe(false);

    state.closeEditor();
    state.openEditor(raster('older'));
    state.apply();
    await settle();
    expect(bakeBufferToBitmapFields).toHaveBeenCalledTimes(1);
  });

  it('does not mark edits made after Apply started as clean', async () => {
    const bake = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    vi.mocked(bakeBufferToBitmapFields).mockReturnValue(bake.promise);
    const applying = session('same', 4, true);
    useImageEditorStore.setState({ session: applying });

    useImageEditorStore.getState().apply();
    useImageEditorStore.setState({
      session: { ...applying, revision: applying.revision + 1, dirtySinceApply: true },
    });
    bake.resolve({ dataUrl: 'data:image/png;base64,edited', lumaBase64: 'AAA=' });
    await settle();

    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(true);
  });

  it('applies a pure Image Size resample with its new pixel dimensions', async () => {
    const resized = commitImageSize(session('resized', 1, true), 8, 6);
    vi.mocked(bakeBufferToBitmapFields).mockResolvedValue({
      dataUrl: 'data:image/png;base64,resized',
      lumaBase64: 'AAA=',
    });
    useImageEditorStore.setState({ session: resized });

    useImageEditorStore.getState().apply();
    await settle();

    expect(useStore.getState().applyEditedImage).toHaveBeenCalledWith('resized', {
      dataUrl: 'data:image/png;base64,resized',
      lumaBase64: 'AAA=',
      pixelWidth: 8,
      pixelHeight: 6,
    });
  });

  it('does not close a newer session or trace stale intent after Apply and Trace', async () => {
    const bake = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    const onApplied = vi.fn();
    vi.mocked(bakeBufferToBitmapFields).mockReturnValue(bake.promise);
    useImageEditorStore.setState({ session: session('older', 2, true) });

    useImageEditorStore.getState().applyAndTrace(onApplied);
    useImageEditorStore.getState().closeEditor();
    useImageEditorStore.setState({ session: session('newer', 1, true) });
    bake.resolve({ dataUrl: 'data:image/png;base64,edited', lumaBase64: 'AAA=' });
    await settle();

    expect(useImageEditorStore.getState().session?.objectId).toBe('newer');
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('clears a pending crop when the owning session closes', () => {
    useImageEditorStore.setState({ session: session('older') });
    useImageEditorStore.getState().setPendingCrop({ x: 0, y: 0, width: 2, height: 2 });
    useImageEditorStore.getState().closeEditor();
    useImageEditorStore.setState({ session: session('newer') });
    useImageEditorStore.getState().commitPendingCrop();

    expect(useImageEditorStore.getState().session?.doc).toMatchObject({ width: 4, height: 4 });
    expect(useImageEditorStore.getState().pendingCrop).toBeNull();
  });

  it('clears a pending crop before opening another image', async () => {
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    useImageEditorStore.setState({ session: session('older') });
    useImageEditorStore.getState().setPendingCrop({ x: 0, y: 0, width: 2, height: 2 });
    const newerImage = raster('newer');
    setCurrentImages(newerImage);

    useImageEditorStore.getState().openEditor(newerImage);
    expect(useImageEditorStore.getState().pendingCrop).toBeNull();
    await settle();
    useImageEditorStore.getState().commitPendingCrop();

    expect(useImageEditorStore.getState().session?.objectId).toBe('newer');
    expect(useImageEditorStore.getState().session?.doc).toMatchObject({ width: 4, height: 4 });
  });

  it('retains the existing transform cleanup when the owning session closes', () => {
    useImageEditorStore.setState({ session: session('older') });
    useImageEditorStore.getState().startTransform();
    expect(useImageEditorStore.getState().transform).not.toBeNull();

    useImageEditorStore.getState().closeEditor();

    expect(useImageEditorStore.getState().transform).toBeNull();
  });

  it('retains the existing transform cleanup before opening another image', () => {
    vi.mocked(decodeRasterToBuffer).mockReturnValue(new Promise(() => undefined));
    useImageEditorStore.setState({ session: session('older') });
    useImageEditorStore.getState().startTransform();
    expect(useImageEditorStore.getState().transform).not.toBeNull();

    useImageEditorStore.getState().openEditor(raster('newer'));

    expect(useImageEditorStore.getState().transform).toBeNull();
    expect(useImageEditorStore.getState().loadState).toMatchObject({
      kind: 'loading',
      objectId: 'newer',
    });
  });
});
