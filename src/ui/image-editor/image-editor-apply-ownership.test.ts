import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function projectWith(...images: ReadonlyArray<RasterImage>): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: images } };
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

async function openDirty(image: RasterImage): Promise<void> {
  useImageEditorStore.getState().openEditor(image);
  await settle();
  useImageEditorStore.setState((state) => ({
    session:
      state.session === null
        ? null
        : { ...state.session, revision: state.session.revision + 1, dirtySinceApply: true },
  }));
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
  });
});

afterEach(() => {
  useStore.setState({ applyEditedImage: ORIGINAL_APPLY_EDITED_IMAGE });
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

describe('Image Studio Apply request ownership', () => {
  it('rejoins the same pending request when the same document session reopens', async () => {
    const image = raster('same-document');
    const bake = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    vi.mocked(bakeBufferToBitmapFields).mockReturnValue(bake.promise);
    useStore.setState({ project: projectWith(image), projectDocumentEpoch: 39 });

    await openDirty(image);
    useImageEditorStore.getState().apply();
    useImageEditorStore.getState().closeEditor();
    useImageEditorStore.getState().openEditor(image);

    expect(useImageEditorStore.getState().isApplying).toBe(true);
    useImageEditorStore.getState().apply();
    expect(bakeBufferToBitmapFields).toHaveBeenCalledOnce();
    bake.resolve({ dataUrl: 'data:image/png;base64,same', lumaBase64: 'AAA=' });
    await settle();
    expect(useImageEditorStore.getState().isApplying).toBe(false);
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(false);
    expect(useStore.getState().applyEditedImage).toHaveBeenCalledOnce();
  });

  it('lets B apply while A is unresolved and ignores A when it completes late', async () => {
    const imageA = raster('A');
    const imageB = raster('B');
    const bakeA = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    vi.mocked(bakeBufferToBitmapFields)
      .mockReturnValueOnce(bakeA.promise)
      .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,B', lumaBase64: 'BBB=' });
    useStore.setState({ project: projectWith(imageA, imageB), projectDocumentEpoch: 40 });

    await openDirty(imageA);
    useImageEditorStore.getState().apply();
    useImageEditorStore.getState().closeEditor();
    await openDirty(imageB);
    expect(useImageEditorStore.getState().isApplying).toBe(false);

    useImageEditorStore.getState().apply();
    await settle();
    expect(useStore.getState().applyEditedImage).toHaveBeenCalledOnce();
    expect(useStore.getState().applyEditedImage).toHaveBeenCalledWith(
      'B',
      expect.objectContaining({ dataUrl: 'data:image/png;base64,B' }),
    );

    bakeA.resolve({ dataUrl: 'data:image/png;base64,A', lumaBase64: 'AAA=' });
    await settle();
    expect(useStore.getState().applyEditedImage).toHaveBeenCalledOnce();
    expect(useImageEditorStore.getState().session?.objectId).toBe('B');
    expect(useImageEditorStore.getState().stash['A']?.session.dirtySinceApply).toBe(true);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('does not let late A failure release or report over an active B request', async () => {
    const imageA = raster('A');
    const imageB = raster('B');
    const bakeA = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    const bakeB = deferred<{ readonly dataUrl: string; readonly lumaBase64: string }>();
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    vi.mocked(bakeBufferToBitmapFields)
      .mockReturnValueOnce(bakeA.promise)
      .mockReturnValueOnce(bakeB.promise);
    useStore.setState({ project: projectWith(imageA, imageB), projectDocumentEpoch: 41 });

    await openDirty(imageA);
    useImageEditorStore.getState().apply();
    useImageEditorStore.getState().closeEditor();
    await openDirty(imageB);
    useImageEditorStore.getState().apply();
    expect(useImageEditorStore.getState().isApplying).toBe(true);

    bakeA.reject(new Error('late A failure'));
    await settle();
    expect(useImageEditorStore.getState().isApplying).toBe(true);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useStore.getState().applyEditedImage).not.toHaveBeenCalled();

    bakeB.resolve({ dataUrl: 'data:image/png;base64,B', lumaBase64: 'BBB=' });
    await settle();
    expect(useImageEditorStore.getState().isApplying).toBe(false);
    expect(useStore.getState().applyEditedImage).toHaveBeenCalledOnce();
  });
});

describe('Image Studio stash document ownership', () => {
  it('purges a different-id old-document stash while preserving same-document reopen', async () => {
    const imageA = raster('document-A-image');
    const imageB = raster('document-B-image');
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    useStore.setState({ project: projectWith(imageA), projectDocumentEpoch: 50 });

    await openDirty(imageA);
    useImageEditorStore.getState().closeEditor();
    expect(useImageEditorStore.getState().stash[imageA.id]).toBeDefined();

    useStore.setState({ project: projectWith(imageB), projectDocumentEpoch: 51 });
    await openDirty(imageB);
    expect(useImageEditorStore.getState().stash[imageA.id]).toBeUndefined();
    const documentBSession = useImageEditorStore.getState().session;
    useImageEditorStore.getState().closeEditor();
    useImageEditorStore.getState().openEditor(imageB);

    expect(decodeRasterToBuffer).toHaveBeenCalledTimes(2);
    expect(useImageEditorStore.getState().session).toBe(documentBSession);
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(true);
  });
});
