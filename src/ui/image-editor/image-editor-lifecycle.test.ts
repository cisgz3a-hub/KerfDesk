import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaBuffer } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { createSession, type EditorSession } from './editor-session';
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
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(decodeRasterToBuffer).mockReset();
  vi.mocked(bakeBufferToBitmapFields).mockReset();
  useStore.setState({ applyEditedImage: vi.fn() });
  useImageEditorStore.setState({
    session: null,
    stash: {},
    loadState: { kind: 'idle' },
    isApplying: false,
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
  it('ignores stale decode success after a newer image open starts', async () => {
    const older = deferred<RgbaBuffer>();
    const newer = deferred<RgbaBuffer>();
    vi.mocked(decodeRasterToBuffer).mockImplementation((image) =>
      image.id === 'older' ? older.promise : newer.promise,
    );

    useImageEditorStore.getState().openEditor(raster('older'));
    useImageEditorStore.getState().openEditor(raster('newer'));
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

    useImageEditorStore.getState().openEditor(raster('older'));
    useImageEditorStore.getState().openEditor(raster('newer'));
    newer.resolve(createRgbaBuffer(4, 4));
    await settle();
    older.reject(new Error('stale decode failed'));
    await settle();

    expect(useImageEditorStore.getState().session?.objectId).toBe('newer');
    expect(useImageEditorStore.getState().loadState).toEqual({ kind: 'idle' });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('ignores a decode completion after the editor closes', async () => {
    const pending = deferred<RgbaBuffer>();
    vi.mocked(decodeRasterToBuffer).mockReturnValue(pending.promise);

    useImageEditorStore.getState().openEditor(raster('closing'));
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
    expect(state.stash['older']?.dirtySinceApply).toBe(false);

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

    useImageEditorStore.getState().openEditor(raster('newer'));
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
