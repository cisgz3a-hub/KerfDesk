import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedPsdImport } from '../import/psd-import-preparation';
import type { ImportWorkerRequestOptions } from '../import/import-worker-client';
import { useStore } from '../state/store';
import { importPsdFile } from './psd-import-action';
import { importFileKind, dispatchImportFilesInOrder } from './import-dispatch';

const worker = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('../import/import-worker-client', () => ({ preparePsdOffThread: worker.prepare }));
const file = () => new File(['test'], 'design.psd');
const result: PreparedPsdImport = {
  natural: { width: 300, height: 180 },
  sampled: { width: 300, height: 180 },
  density: { xDpi: 300, yDpi: 150 },
  dataUrl: 'data:image/png;base64,AA==',
  lumaBase64: '',
  hasColorProfile: false,
};
const actions = () => ({ isCurrent: () => true, importRasterImage: vi.fn(), pushToast: vi.fn() });
beforeEach(() => {
  worker.prepare.mockReset();
  useStore.getState().newProject();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PSD artwork import', () => {
  it('recognizes PSD extension and MIME but does not advertise PSB', () => {
    expect(importFileKind({ name: 'ART.PSD', type: '' })).toBe('psd');
    expect(importFileKind({ name: 'art', type: 'image/vnd.adobe.photoshop' })).toBe('psd');
    expect(importFileKind({ name: 'art.psb', type: '' })).toBeNull();
  });
  it('inserts a flattened raster with independent physical density and one undo', async () => {
    worker.prepare.mockResolvedValue(result);
    const ctx = actions();
    ctx.importRasterImage.mockImplementation((object) =>
      useStore.getState().importRasterImage(object),
    );
    await importPsdFile(file(), ctx);
    expect(ctx.importRasterImage).toHaveBeenCalledOnce();
    expect(ctx.importRasterImage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'raster-image',
        source: 'design.psd',
        bounds: { minX: 0, minY: 0, maxX: 25.4, maxY: 30.479999999999997 },
        pixelWidth: 300,
        pixelHeight: 180,
        dataUrl: result.dataUrl,
      }),
    );
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('Layers remain flattened'),
      'success',
    );
  });
  it('dispatches PSD through the same mixed-file insertion index', async () => {
    worker.prepare.mockResolvedValue(result);
    const ctx = {
      getProjectDocumentEpoch: () => 0,
      importSvgObject: vi.fn(),
      importRasterImage: vi.fn(),
      pushToast: vi.fn(),
    };
    await dispatchImportFilesInOrder([file(), file()], ctx);
    expect(ctx.importRasterImage.mock.calls.map((call) => call[1])).toEqual([0, 1]);
  });
  it.each([null, new Error('ZIP-compressed PSD composite unsupported')])(
    'leaves the scene unchanged when preparation cannot succeed',
    async (failure) => {
      if (failure === null) worker.prepare.mockReturnValue(null);
      else worker.prepare.mockRejectedValue(failure);
      const ctx = actions();
      const before = useStore.getState().project;
      await importPsdFile(file(), ctx);
      expect(ctx.importRasterImage).not.toHaveBeenCalled();
      expect(useStore.getState().project).toBe(before);
      expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringMatching(/unavailable|ZIP/), 'error');
    },
  );
  it('aborts on Escape and removes the event listener after cancellation', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    worker.prepare.mockImplementation(
      (_blob: Blob, options: ImportWorkerRequestOptions) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          ),
        ),
    );
    const ctx = actions();
    const pending = importPsdFile(file(), ctx);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await pending;
    expect(ctx.importRasterImage).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith('design.psd: import cancelled.', 'info');
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
  it('cancels decode when the document is replaced, suppressing stale messages and insertion', async () => {
    let current = true;
    let signal: AbortSignal | undefined;
    worker.prepare.mockImplementation((_blob: Blob, options: ImportWorkerRequestOptions) => {
      signal = options.signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () =>
          reject(new DOMException('cancelled', 'AbortError')),
        ),
      );
    });
    const ctx = { ...actions(), isCurrent: () => current };
    const pending = importPsdFile(file(), ctx);
    ctx.pushToast.mockClear();
    current = false;
    useStore.getState().newProject();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(ctx.importRasterImage).not.toHaveBeenCalled();
    expect(ctx.pushToast).not.toHaveBeenCalled();
  });
});
