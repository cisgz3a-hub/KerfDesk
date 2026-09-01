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

function seedSession(): {
  readonly session: ReturnType<typeof createSession>;
  readonly sessionOwner: {
    readonly projectDocumentEpoch: number;
    readonly sourceImage: RasterImage;
  };
} {
  const session = createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS);
  const sessionOwner = {
    projectDocumentEpoch: 1,
    sourceImage: { id: 'R1', kind: 'raster-image' } as RasterImage,
  };
  useImageEditorStore.setState({
    session,
    sessionOwner,
    transform: null,
  });
  return { session, sessionOwner };
}

function openText(text: string): void {
  useTextDialogStore.getState().open();
  useTextDialogStore.getState().setText(text);
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  raster.rasterizeTextLayer.mockReset();
  useTextDialogStore.setState({
    isOpen: false,
    dialogOwner: null,
    text: '',
    fontKey: 'roboto-regular',
    sizePx: 48,
    ink: 'black',
    commitRequest: null,
    errorMessage: null,
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

    const textDialog = useTextDialogStore.getState();
    expect(textDialog.isOpen).toBe(true);
    expect(textDialog.dialogOwner?.session).toBe(useImageEditorStore.getState().session);
    expect(textDialog.dialogOwner?.sessionOwner).toBe(useImageEditorStore.getState().sessionOwner);
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
    openText('Old document');
    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());

    useImageEditorStore.setState({
      session: replacementSession,
      sessionOwner: { projectDocumentEpoch: 2, sourceImage: replacementImage },
    });
    rendered.resolve(createRgbaBuffer(16, 16));
    await pending;

    expect(useImageEditorStore.getState().session).toBe(replacementSession);
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: false,
      dialogOwner: null,
      text: '',
      commitRequest: null,
      errorMessage: null,
    });
  });

  it('retires the exact opening draft on removal and does not remount it with the same session', async () => {
    const { session, sessionOwner } = seedSession();
    openText('Must not remount');

    useImageEditorStore.setState({ session: null, sessionOwner: null });
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: false,
      dialogOwner: null,
      text: '',
    });

    useImageEditorStore.setState({ session, sessionOwner });
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: false,
      dialogOwner: null,
      text: '',
    });
    await useTextDialogStore.getState().commit();
    expect(raster.rasterizeTextLayer).not.toHaveBeenCalled();
  });

  it('discards deferred text rasterization after the exact dialog request closes', async () => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    const session = createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS);
    const sourceImage = { id: 'R1', kind: 'raster-image' } as RasterImage;
    const sessionOwner = { projectDocumentEpoch: 1, sourceImage };
    useImageEditorStore.setState({ session, sessionOwner });
    openText('Cancelled text');

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

  it('owns an exact raster rejection, keeps the text open, and leaves the session untouched', async () => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    const session = createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS);
    const sourceImage = { id: 'R1', kind: 'raster-image' } as RasterImage;
    const sessionOwner = { projectDocumentEpoch: 1, sourceImage };
    useImageEditorStore.setState({ session, sessionOwner });
    openText('Keep this text');

    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());
    rendered.reject(new Error('font bytes unavailable'));
    await pending;

    expect(useImageEditorStore.getState()).toMatchObject({ session, sessionOwner });
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: true,
      text: 'Keep this text',
      commitRequest: null,
      errorMessage: 'Could not add text: font bytes unavailable',
    });
  });

  it('does not publish a rejection into a same-id replacement session', async () => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    const startingSession = createSession('R1', 'source.png', createRgbaBuffer(16, 16), BOUNDS);
    const replacementSession = createSession(
      'R1',
      'replacement.png',
      createRgbaBuffer(16, 16),
      BOUNDS,
    );
    useImageEditorStore.setState({
      session: startingSession,
      sessionOwner: {
        projectDocumentEpoch: 1,
        sourceImage: { id: 'R1', kind: 'raster-image' } as RasterImage,
      },
    });
    openText('Old text');
    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());

    useImageEditorStore.setState({
      session: replacementSession,
      sessionOwner: {
        projectDocumentEpoch: 2,
        sourceImage: { id: 'R1', kind: 'raster-image' } as RasterImage,
      },
    });
    rendered.reject(new Error('old document font failure'));
    await pending;

    expect(useImageEditorStore.getState().session).toBe(replacementSession);
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: false,
      dialogOwner: null,
      text: '',
      commitRequest: null,
      errorMessage: null,
    });
  });

  it('does not publish a rejection after the owning dialog closes', async () => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    seedSession();
    const session = useImageEditorStore.getState().session;
    openText('Cancelled text');

    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());
    useTextDialogStore.getState().close();
    rendered.reject(new Error('late font failure'));
    await pending;

    expect(useImageEditorStore.getState().session).toBe(session);
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: false,
      commitRequest: null,
      errorMessage: null,
    });
  });

  it('retires a pending raster success when the text draft changes', async () => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    const { session } = seedSession();
    openText('Old draft');

    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());
    useTextDialogStore.getState().setText('Current draft');
    rendered.resolve(createRgbaBuffer(16, 16));
    await pending;

    expect(useImageEditorStore.getState().session).toBe(session);
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: true,
      text: 'Current draft',
      commitRequest: null,
      errorMessage: null,
    });
  });

  it.each([
    ['font', () => useTextDialogStore.getState().setFontKey('poppins-regular')],
    ['size', () => useTextDialogStore.getState().setSizePx(72.5)],
    ['blank size', () => useTextDialogStore.getState().setSizePx(0)],
    ['ink', () => useTextDialogStore.getState().setInk('white')],
  ])('retires a pending raster failure when the %s draft changes', async (_label, edit) => {
    const rendered = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer.mockReturnValue(rendered.promise);
    const { session } = seedSession();
    openText('Draft');

    const pending = useTextDialogStore.getState().commit();
    await vi.waitFor(() => expect(raster.rasterizeTextLayer).toHaveBeenCalledOnce());
    edit();
    rendered.reject(new Error('retired request'));
    await pending;

    expect(useImageEditorStore.getState().session).toBe(session);
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: true,
      commitRequest: null,
      errorMessage: null,
    });
  });

  it('lets only the latest retry publish rejection feedback', async () => {
    const first = deferred<ReturnType<typeof createRgbaBuffer>>();
    const second = deferred<ReturnType<typeof createRgbaBuffer>>();
    raster.rasterizeTextLayer
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    seedSession();
    const session = useImageEditorStore.getState().session;
    openText('Retry text');

    const firstPending = useTextDialogStore.getState().commit();
    const firstRequest = useTextDialogStore.getState().commitRequest;
    const secondPending = useTextDialogStore.getState().commit();
    const secondRequest = useTextDialogStore.getState().commitRequest;
    expect(secondRequest).not.toBe(firstRequest);

    first.reject(new Error('stale failure'));
    await firstPending;
    expect(useTextDialogStore.getState()).toMatchObject({
      commitRequest: secondRequest,
      errorMessage: null,
    });

    second.reject(new Error('current failure'));
    await secondPending;
    expect(useImageEditorStore.getState().session).toBe(session);
    expect(useTextDialogStore.getState()).toMatchObject({
      isOpen: true,
      text: 'Retry text',
      commitRequest: null,
      errorMessage: 'Could not add text: current failure',
    });
  });
});
