import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  createLayer,
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
  it('aborts worker work immediately on cancellation and never publishes a late result', async () => {
    const source = svg('cancel.svg');
    useStore.setState({ project: projectWith(source) });
    const pending = deferred<RasterImage>();
    const apply = vi.fn();
    const toast = vi.fn();
    const controller = new AbortController();
    vi.mocked(buildBitmapFromVectors).mockReturnValue(pending.promise);
    const conversion = convertSelectedVectorsToBitmap(
      [source],
      [],
      { renderType: 'fill-all', dpi: 254, brightnessPercent: 50 },
      apply,
      toast,
      controller.signal,
    );
    const workerSignal = vi.mocked(buildBitmapFromVectors).mock.calls[0]?.[2];
    controller.abort();
    expect(workerSignal?.aborted).toBe(true);
    pending.resolve(raster());
    expect(await conversion).toEqual({ kind: 'cancelled' });
    expect(apply).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('aborts Use Cut Settings when operation mode changes without changing source identity', async () => {
    const source = svg('cut-settings.svg');
    const layer = createLayer({ id: 'operation', color: '#000000', mode: 'fill' });
    const project = projectWith(source);
    useStore.setState({ project: { ...project, scene: { ...project.scene, layers: [layer] } } });
    const pending = deferred<RasterImage>();
    const apply = vi.fn();
    vi.mocked(buildBitmapFromVectors).mockReturnValue(pending.promise);
    const conversion = convertSelectedVectorsToBitmap(
      [source],
      [layer],
      { renderType: 'use-cut-settings', dpi: 254, brightnessPercent: 50 },
      apply,
      vi.fn(),
    );
    const workerSignal = vi.mocked(buildBitmapFromVectors).mock.calls[0]?.[2];
    useStore.getState().setLayerParam(layer.id, { mode: 'line' });
    expect(workerSignal?.aborted).toBe(true);
    pending.resolve(raster());
    expect(await conversion).toEqual({ kind: 'stale' });
    expect(apply).not.toHaveBeenCalled();
    expect(useStore.getState().project.scene.objects[0]).toBe(source);
  });

  it('keeps conversion current when unrelated operation speed changes', async () => {
    const source = svg('cut-settings.svg');
    const layer = createLayer({ id: 'operation', color: '#000000', mode: 'fill' });
    const project = projectWith(source);
    useStore.setState({ project: { ...project, scene: { ...project.scene, layers: [layer] } } });
    const pending = deferred<RasterImage>();
    const apply = vi.fn();
    vi.mocked(buildBitmapFromVectors).mockReturnValue(pending.promise);
    const conversion = convertSelectedVectorsToBitmap(
      [source],
      [layer],
      { renderType: 'use-cut-settings', dpi: 254, brightnessPercent: 50 },
      apply,
      vi.fn(),
    );
    const workerSignal = vi.mocked(buildBitmapFromVectors).mock.calls[0]?.[2];
    useStore.getState().setLayerParam(layer.id, { speed: layer.speed + 100 });
    expect(workerSignal?.aborted).toBe(false);
    pending.resolve(raster());
    expect(await conversion).toEqual({ kind: 'converted' });
    expect(apply).toHaveBeenCalledOnce();
    useStore.setState({ project: createProject() });
    expect(workerSignal?.aborted).toBe(false);
  });

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
