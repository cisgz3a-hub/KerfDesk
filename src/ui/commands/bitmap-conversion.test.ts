import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { buildBitmapFromVectors } from '../raster/vector-to-bitmap';
import { convertSelectedVectorsToBitmap } from './bitmap-conversion';

vi.mock('../raster/vector-to-bitmap', () => ({ buildBitmapFromVectors: vi.fn() }));

function svg(source: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'persisted-vector-id',
    source,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'converted-raster',
    source: 'project-a.svg (bitmap)',
    dataUrl: 'data:image/png;base64,converted',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function projectWith(source: ImportedSvg): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [source] } };
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

beforeEach(() => {
  resetStore();
  vi.mocked(buildBitmapFromVectors).mockReset();
});

describe('Convert to Bitmap document ownership', () => {
  it('does not replace same-id artwork in a project opened while conversion is pending', async () => {
    const sourceA = svg('project-a.svg');
    const sourceB = svg('project-b.svg');
    const pending = deferred<RasterImage>();
    const convertToBitmap = vi.fn();
    const pushToast = vi.fn();
    vi.mocked(buildBitmapFromVectors).mockReturnValue(pending.promise);
    useStore.setState({ project: projectWith(sourceA), projectDocumentEpoch: 30 });

    const conversion = convertSelectedVectorsToBitmap(
      [sourceA],
      [],
      { renderType: 'fill-all', dpi: 254, brightnessPercent: 50 },
      convertToBitmap,
      pushToast,
    );
    useStore.setState({ project: projectWith(sourceB), projectDocumentEpoch: 31 });
    pending.resolve(raster());
    await conversion;

    expect(convertToBitmap).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('does not publish when the source object identity changes inside the same document', async () => {
    const sourceA = svg('project-a.svg');
    const replacement = svg('replacement.svg');
    const pending = deferred<RasterImage>();
    const convertToBitmap = vi.fn();
    vi.mocked(buildBitmapFromVectors).mockReturnValue(pending.promise);
    useStore.setState({ project: projectWith(sourceA), projectDocumentEpoch: 40 });

    const conversion = convertSelectedVectorsToBitmap(
      [sourceA],
      [],
      { renderType: 'fill-all', dpi: 254, brightnessPercent: 50 },
      convertToBitmap,
      vi.fn(),
    );
    useStore.setState({ project: projectWith(replacement), projectDocumentEpoch: 40 });
    pending.resolve(raster());
    await conversion;

    expect(convertToBitmap).not.toHaveBeenCalled();
  });

  it('publishes and reports success while the initiating sources still own the document', async () => {
    const source = svg('same-document.svg');
    const converted = raster();
    const convertToBitmap = vi.fn();
    const pushToast = vi.fn();
    vi.mocked(buildBitmapFromVectors).mockResolvedValue(converted);
    useStore.setState({ project: projectWith(source), projectDocumentEpoch: 50 });

    await convertSelectedVectorsToBitmap(
      [source],
      [],
      { renderType: 'fill-all', dpi: 254, brightnessPercent: 50 },
      convertToBitmap,
      pushToast,
    );

    expect(convertToBitmap).toHaveBeenCalledWith([source.id], converted);
    expect(pushToast).toHaveBeenCalledWith(`Converted to bitmap: ${converted.source}`, 'success');
  });

  it('does not report a stale conversion failure after the document is replaced', async () => {
    const sourceA = svg('project-a.svg');
    const sourceB = svg('project-b.svg');
    const pending = deferred<RasterImage>();
    const pushToast = vi.fn();
    vi.mocked(buildBitmapFromVectors).mockReturnValue(pending.promise);
    useStore.setState({ project: projectWith(sourceA), projectDocumentEpoch: 60 });

    const conversion = convertSelectedVectorsToBitmap(
      [sourceA],
      [],
      { renderType: 'fill-all', dpi: 254, brightnessPercent: 50 },
      vi.fn(),
      pushToast,
    );
    useStore.setState({ project: projectWith(sourceB), projectDocumentEpoch: 61 });
    pending.reject(new Error('stale worker failure'));
    await conversion;

    expect(pushToast).not.toHaveBeenCalled();
  });
});
