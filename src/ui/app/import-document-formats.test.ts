import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
import { dispatchImportFilesInOrder, importFileKind } from './import-dispatch';

const calls = vi.hoisted(() => ({ page: vi.fn(), image: vi.fn(), hpgl: vi.fn() }));
vi.mock('../import/request-paged-artwork', () => ({ requestPagedArtwork: calls.page }));
vi.mock('../commands/import-image-action', () => ({ importImageFile: calls.image }));
vi.mock('./hpgl-import-action', () => ({ importHpglFile: calls.hpgl }));

function actions() {
  return {
    getProjectDocumentEpoch: () => 0,
    importSvgObject: vi.fn(() => ({ kind: 'added' as const })),
    importRasterImage: vi.fn(),
    pushToast: vi.fn(),
  };
}
const raster = { id: 'raster', kind: 'raster-image' } as SceneObject;
const vector = { id: 'vector', kind: 'imported-svg' } as SceneObject;
beforeEach(() => vi.resetAllMocks());

function pageResult(object: SceneObject | null) {
  return async (
    _file: File,
    _kind: string,
    _current: () => boolean,
    commit: (object: SceneObject) => void,
  ) => {
    if (object !== null) commit(object);
    return object;
  };
}

describe('additional import formats', () => {
  it.each([
    ['plan.PDF', 'pdf'],
    ['drawing.ai', 'pdf'],
    ['drawing.hpgl', 'hpgl'],
    ['drawing.plt', 'hpgl'],
    ['photo.BMP', 'image'],
    ['motion.gif', 'image'],
    ['scan.tif', 'tiff'],
    ['scan.TIFF', 'tiff'],
  ])('classifies %s as %s', (name, kind) => {
    expect(importFileKind({ name, type: '' })).toBe(kind);
  });

  it('routes plotter artwork through HPGL and shares successful placement indexes', async () => {
    calls.hpgl.mockImplementation(async (_file, callbacks) => {
      callbacks.importObject(vector, callbacks.nextSuccessIndex());
    });
    calls.page.mockImplementationOnce(pageResult(raster));
    const ctx = { ...actions(), openGcodeInspector: vi.fn() };
    await dispatchImportFilesInOrder([new File([], 'plot.plt'), new File([], 'page.pdf')], ctx);
    expect(calls.hpgl).toHaveBeenCalledOnce();
    expect(ctx.importSvgObject).toHaveBeenCalledWith(vector, 0);
    expect(ctx.importRasterImage).toHaveBeenCalledWith(raster, 1);
    expect(ctx.openGcodeInspector).not.toHaveBeenCalled();
  });

  it('keeps page cancellation out of placement indexes and preserves mixed file order', async () => {
    calls.page
      .mockImplementationOnce(pageResult(null))
      .mockImplementationOnce(pageResult(vector))
      .mockImplementationOnce(pageResult(raster));
    calls.image.mockImplementation(async (_file, insert) => {
      insert(raster);
    });
    const ctx = actions();
    await dispatchImportFilesInOrder(
      [
        new File([], 'cancel.pdf'),
        new File([], 'paths.ai'),
        new File([], 'image.gif'),
        new File([], 'scan.tiff'),
      ],
      ctx,
    );
    expect(ctx.importSvgObject).toHaveBeenCalledWith(vector, 0);
    expect(ctx.importRasterImage.mock.calls).toEqual([
      [raster, 1],
      [raster, 2],
    ]);
    expect(calls.page.mock.calls.map(([file, kind]) => [file.name, kind])).toEqual([
      ['cancel.pdf', 'pdf'],
      ['paths.ai', 'pdf'],
      ['scan.tiff', 'tiff'],
    ]);
  });

  it('discards a page result after document replacement and stops the remaining batch', async () => {
    let epoch = 0;
    calls.page.mockImplementation(async (_file, _kind, current, commit) => {
      epoch += 1;
      expect(current()).toBe(false);
      commit(vector);
      return vector;
    });
    const ctx = { ...actions(), getProjectDocumentEpoch: () => epoch };
    await dispatchImportFilesInOrder([new File([], 'late.pdf'), new File([], 'next.bmp')], ctx);
    expect(ctx.importSvgObject).not.toHaveBeenCalled();
    expect(calls.image).not.toHaveBeenCalled();
    expect(ctx.pushToast).not.toHaveBeenCalled();
  });

  it('reports a decoder failure and continues the batch', async () => {
    calls.page.mockRejectedValueOnce(new Error('Unsupported compression'));
    calls.image.mockImplementation(async (_file, insert) => {
      insert(raster);
    });
    const ctx = actions();
    await dispatchImportFilesInOrder([new File([], 'bad.tif'), new File([], 'next.bmp')], ctx);
    expect(ctx.importRasterImage).toHaveBeenCalledWith(raster, 0);
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported compression'),
      'error',
    );
  });
});
