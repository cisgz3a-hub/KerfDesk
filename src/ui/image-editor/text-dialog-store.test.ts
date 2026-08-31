import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_AFFINE } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { RasterImage } from '../../core/scene';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { useTextDialogStore } from './text-dialog-store';

const raster = vi.hoisted(() => ({ rasterizeTextLayer: vi.fn() }));
vi.mock('./editor-text-raster', () => ({ rasterizeTextLayer: raster.rasterizeTextLayer }));

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function seedSession(): void {
  useImageEditorStore.setState({
    session: createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS),
    transform: null,
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  raster.rasterizeTextLayer.mockReset();
  useTextDialogStore.setState({
    isOpen: false,
    text: '',
    sizePx: 48,
    commitRequest: null,
  });
  useImageEditorStore.setState({ session: null, sessionOwner: null, transform: null });
});

describe('useTextDialogStore', () => {
  it('commits an active transform before opening', () => {
    seedSession();
    useImageEditorStore.getState().startTransform();
    useImageEditorStore.getState().updateTransformAffine({
      ...IDENTITY_AFFINE,
      translateX: 1,
    });

    useTextDialogStore.getState().open();

    expect(useTextDialogStore.getState().isOpen).toBe(true);
    expect(useImageEditorStore.getState().transform).toBeNull();
    expect(useImageEditorStore.getState().session?.history.undoStack.at(-1)?.label).toBe(
      'Free transform',
    );
  });

  it('accepts positive fractional and document-scale sizes without a fixed cap', () => {
    useTextDialogStore.getState().setSizePx(1024.5);
    expect(useTextDialogStore.getState().sizePx).toBe(1024.5);
  });

  it('keeps the last valid size for non-positive or non-finite input', () => {
    useTextDialogStore.getState().setSizePx(24.25);
    useTextDialogStore.getState().setSizePx(0);
    useTextDialogStore.getState().setSizePx(Number.NaN);
    expect(useTextDialogStore.getState().sizePx).toBe(24.25);
  });

  it('discards deferred text rasterization after a same-id replacement session opens', async () => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    const startingSession = createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS);
    const replacementSession = createSession(
      'R1',
      'replacement.png',
      createRgbaBuffer(16, 16),
      BOUNDS,
    );
    const sourceImage = { id: 'R1', kind: 'raster-image' } as RasterImage;
    const replacementImage = { id: 'R1', kind: 'raster-image' } as RasterImage;
    useImageEditorStore.setState({
      session: startingSession,
      sessionOwner: { projectDocumentEpoch: 1, sourceImage },
    });
    useTextDialogStore.setState({ isOpen: true, text: 'Old document' });
    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());

    useImageEditorStore.setState({
      session: replacementSession,
      sessionOwner: { projectDocumentEpoch: 2, sourceImage: replacementImage },
    });
    rendered.resolve(createRgbaBuffer(16, 16));
    await pending;

    expect(useImageEditorStore.getState().session).toBe(replacementSession);
    expect(useTextDialogStore.getState().isOpen).toBe(true);
  });

  it('discards deferred text rasterization after the exact dialog request closes', async () => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    const session = createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS);
    const sourceImage = { id: 'R1', kind: 'raster-image' } as RasterImage;
    const sessionOwner = { projectDocumentEpoch: 1, sourceImage };
    useImageEditorStore.setState({ session, sessionOwner });
    useTextDialogStore.setState({ isOpen: true, text: 'Cancelled text' });

    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());
    useTextDialogStore.getState().close();
    rendered.resolve(createRgbaBuffer(16, 16));
    await pending;

    expect(useImageEditorStore.getState()).toMatchObject({ session, sessionOwner });
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: false,
      commitRequest: null,
    });
  });
});
