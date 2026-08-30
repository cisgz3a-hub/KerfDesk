import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { cropMaskedRasterImage } from '../raster/crop-image';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { cropImageAction } from './image-command-actions';

vi.mock('../raster/crop-image', () => ({ cropMaskedRasterImage: vi.fn() }));

function projectWith(...objects: Project['scene']['objects']): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects } };
}

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source',
    source: 'source.png',
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

describe('Crop exact mask ownership', () => {
  it('does not publish after only the same-id mask identity changes in the same document', async () => {
    const maskA = createRectangle({
      id: 'mask',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const source = { ...raster(), imageMaskId: maskA.id };
    const maskB = { ...maskA };
    const project = projectWith(source, maskA);
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
    useStore.setState({ project: projectWith(source, maskB), projectDocumentEpoch: 60 });
    pending.resolve({ ...source, source: 'cropped.png' });
    await pending.promise;
    await Promise.resolve();

    expect(cropImage).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});
