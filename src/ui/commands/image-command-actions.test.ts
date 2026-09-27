import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { cropMaskedRasterImage } from '../raster/crop-image';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  cropImageAction,
  flattenImageMaskAction,
  retraceOriginalAction,
  traceSourceForTracedImage,
} from './image-command-actions';

vi.mock('../raster/crop-image', () => ({ cropMaskedRasterImage: vi.fn() }));

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'src1',
    source: 'logo.png',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 20,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    role: 'trace-source',
  };
}

function trace(sourceId = 'src1'): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace1',
    source: 'logo.png',
    traceSourceId: sourceId,
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

function rasterTrace(sourceId = 'src1'): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster-trace',
    source: 'logo.png (bitmap)',
    traceSourceId: sourceId,
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 20,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function projectWith(...objects: Project['scene']['objects']): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects } };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetStore();
  vi.mocked(cropMaskedRasterImage).mockReset();
});

describe('retraceOriginalAction', () => {
  it('finds the original raster for a trace by traceSourceId', () => {
    const source = raster();
    expect(traceSourceForTracedImage(projectWith(source, trace()), trace())).toBe(source);
  });

  it('opens Trace Image on the original raster instead of the vector trace', () => {
    const source = raster();
    const selected = trace();
    const openImageDialog = vi.fn();
    const pushToast = vi.fn();

    retraceOriginalAction(projectWith(source, selected), selected, openImageDialog, pushToast)();

    expect(openImageDialog).toHaveBeenCalledWith(source, { replaceTraceId: selected.id });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('opens the original raster when the selected trace result is also a raster', () => {
    const source = raster();
    const selected = rasterTrace();
    const openImageDialog = vi.fn();
    const pushToast = vi.fn();

    expect(traceSourceForTracedImage(projectWith(source, selected), selected)).toBe(source);
    retraceOriginalAction(projectWith(source, selected), selected, openImageDialog, pushToast)();

    expect(openImageDialog).toHaveBeenCalledWith(source, { replaceTraceId: selected.id });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('reports a missing original raster instead of tracing the vector geometry', () => {
    const selected = trace('missing-source');
    const openImageDialog = vi.fn();
    const pushToast = vi.fn();

    retraceOriginalAction(projectWith(selected), selected, openImageDialog, pushToast)();

    expect(openImageDialog).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Original raster for logo.png is missing. Re-trace needs the kept source image.',
      'error',
    );
  });
});

describe('cropImageAction document ownership', () => {
  it('does not publish a delayed crop into a replacement project with the same ids', async () => {
    const imageA = raster();
    const maskA = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const maskedA = { ...imageA, imageMaskId: maskA.id };
    const imageB = { ...raster(), source: 'project-b.png', imageMaskId: maskA.id };
    const maskB = { ...maskA };
    const projectA = projectWith(maskedA, maskA);
    const projectB = projectWith(imageB, maskB);
    const pending = deferred<RasterImage>();
    const cropImage = vi.fn();
    const pushToast = vi.fn();
    vi.mocked(cropMaskedRasterImage).mockReturnValue(pending.promise);
    useStore.setState({ project: projectA, projectDocumentEpoch: 20 });

    cropImageAction(
      {
        project: projectA,
        projectDocumentEpoch: 20,
        applyImageMask: vi.fn(),
        cropImage,
        removeImageMask: vi.fn(),
      },
      maskedA,
      pushToast,
    )();
    useStore.setState({ project: projectB, projectDocumentEpoch: 21 });
    pending.resolve({ ...imageA, source: 'cropped-project-a.png' });
    await pending.promise;
    await Promise.resolve();

    expect(cropImage).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('does not publish when the masked source identity changes inside the same document', async () => {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const source = { ...raster(), imageMaskId: mask.id };
    const replacement = { ...source, source: 'replacement.png' };
    const projectA = projectWith(source, mask);
    const pending = deferred<RasterImage>();
    const cropImage = vi.fn();
    vi.mocked(cropMaskedRasterImage).mockReturnValue(pending.promise);
    useStore.setState({ project: projectA, projectDocumentEpoch: 25 });

    cropImageAction(
      {
        project: projectA,
        projectDocumentEpoch: 25,
        applyImageMask: vi.fn(),
        cropImage,
        removeImageMask: vi.fn(),
      },
      source,
      vi.fn(),
    )();
    useStore.setState({ project: projectWith(replacement, mask), projectDocumentEpoch: 25 });
    pending.resolve({ ...source, source: 'cropped.png' });
    await pending.promise;
    await Promise.resolve();

    expect(cropImage).not.toHaveBeenCalled();
  });

  it('does not publish when the exact mask identity changes inside the same document', async () => {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const source = { ...raster(), imageMaskId: mask.id };
    const project = projectWith(source, mask);
    const pending = deferred<RasterImage>();
    const cropImage = vi.fn();
    const pushToast = vi.fn();
    vi.mocked(cropMaskedRasterImage).mockReturnValue(pending.promise);
    useStore.setState({ project, projectDocumentEpoch: 60 });

    cropImageAction(
      {
        project,
        projectDocumentEpoch: 60,
        applyImageMask: vi.fn(),
        cropImage,
        removeImageMask: vi.fn(),
      },
      source,
      pushToast,
    )();
    useStore.setState({ project: projectWith(source, { ...mask }), projectDocumentEpoch: 60 });
    pending.resolve({ ...source, source: 'cropped.png' });
    await pending.promise;
    await Promise.resolve();

    expect(cropImage).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('publishes a crop while the initiating image and mask still own the document', async () => {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const source = { ...raster(), imageMaskId: mask.id };
    const cropped = { ...source, source: 'cropped.png' };
    const project = projectWith(source, mask);
    const cropImage = vi.fn();
    const pushToast = vi.fn();
    vi.mocked(cropMaskedRasterImage).mockResolvedValue(cropped);
    useStore.setState({ project, projectDocumentEpoch: 26 });

    cropImageAction(
      {
        project,
        projectDocumentEpoch: 26,
        applyImageMask: vi.fn(),
        cropImage,
        removeImageMask: vi.fn(),
      },
      source,
      pushToast,
    )();
    await Promise.resolve();
    await Promise.resolve();

    expect(cropImage).toHaveBeenCalledWith(source.id, cropped);
    expect(pushToast).toHaveBeenCalledWith(`Cropped image: ${source.source}`, 'success');
  });
});

// Flatten Image Mask (ADR-480) shares Crop Image's bake and ownership checks.
describe('flattenImageMaskAction', () => {
  function maskedProject(): { readonly project: Project; readonly source: RasterImage } {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const source = { ...raster(), imageMaskId: mask.id };
    return { project: projectWith(source, mask), source };
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it.each([
    ['mask-deleted', 'Flattened the mask into logo.png and deleted the mask shape.'],
    [
      'mask-kept',
      'Flattened the mask into logo.png. The mask shape stays because it is locked or still in use.',
    ],
    ['unchanged', null],
  ] as const)('reports the %s outcome', async (outcome, message) => {
    const { project, source } = maskedProject();
    const flattened = { ...source, source: 'flattened.png' };
    const flattenImageMask = vi.fn(() => outcome);
    const pushToast = vi.fn();
    vi.mocked(cropMaskedRasterImage).mockResolvedValue(flattened);
    useStore.setState({ project, projectDocumentEpoch: 40 });

    flattenImageMaskAction(
      { project, projectDocumentEpoch: 40, flattenImageMask },
      source,
      pushToast,
    )();
    await settle();

    expect(flattenImageMask).toHaveBeenCalledWith(source.id, flattened);
    if (message === null) expect(pushToast).not.toHaveBeenCalled();
    else expect(pushToast).toHaveBeenCalledWith(message, 'success');
  });

  it('reports a failed bake with the flatten wording', async () => {
    const { project, source } = maskedProject();
    const flattenImageMask = vi.fn(() => 'mask-deleted');
    const pushToast = vi.fn();
    vi.mocked(cropMaskedRasterImage).mockRejectedValue(new Error('decode failed'));
    useStore.setState({ project, projectDocumentEpoch: 41 });

    flattenImageMaskAction(
      { project, projectDocumentEpoch: 41, flattenImageMask },
      source,
      pushToast,
    )();
    await settle();

    expect(flattenImageMask).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not flatten the image mask: decode failed',
      'error',
    );
  });

  it('flattens through the store and deletes the unused mask shape', async () => {
    const { project, source } = maskedProject();
    const flattened = { ...source, dataUrl: 'data:image/png;base64,flat' };
    const pushToast = vi.fn();
    vi.mocked(cropMaskedRasterImage).mockResolvedValue(flattened);
    useStore.setState({ project, projectDocumentEpoch: 42 });

    flattenImageMaskAction(
      {
        project,
        projectDocumentEpoch: 42,
        flattenImageMask: (imageId, image) => useStore.getState().flattenImageMask(imageId, image),
      },
      source,
      pushToast,
    )();
    await settle();

    const objects = useStore.getState().project.scene.objects;
    expect(objects.map((object) => object.id)).toEqual([source.id]);
    expect(objects[0]).toMatchObject({ dataUrl: 'data:image/png;base64,flat' });
    expect(objects[0]).not.toHaveProperty('imageMaskId');
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(pushToast).toHaveBeenCalledWith(
      'Flattened the mask into logo.png and deleted the mask shape.',
      'success',
    );
  });
});
