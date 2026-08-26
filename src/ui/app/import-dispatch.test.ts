import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { dispatchImportFilesInOrder, handleUnifiedArtworkImport } from './import-dispatch';

const calls = vi.hoisted(() => ({
  order: [] as string[],
  importSvgFiles: vi.fn(),
  importDxfFiles: vi.fn(),
  importImageFile: vi.fn(),
  importStlFiles: vi.fn(),
  openGcodeFileInInspector: vi.fn(),
}));

vi.mock('./svg-import-action', () => ({
  importSvgFiles: calls.importSvgFiles,
}));
vi.mock('./dxf-import-action', () => ({
  importDxfFiles: calls.importDxfFiles,
}));
vi.mock('../commands/import-image-action', () => ({
  importImageFile: calls.importImageFile,
}));
vi.mock('./stl-import-action', () => ({
  importStlFiles: calls.importStlFiles,
}));
vi.mock('./gcode-open-action', () => ({
  openGcodeFileInInspector: calls.openGcodeFileInInspector,
}));

function object(id: string): SceneObject {
  return { id } as SceneObject;
}

function actions() {
  return {
    project: createProject(),
    importSvgObject: vi.fn(() => ({ kind: 'added' as const })),
    importRasterImage: vi.fn(),
    pushToast: vi.fn(),
    openGcodeInspector: vi.fn(),
  };
}

beforeEach(() => {
  calls.order.length = 0;
  vi.clearAllMocks();
});

describe('dispatchImportFilesInOrder', () => {
  it('preserves mixed FileList order and advances one index only for successful artwork', async () => {
    calls.importSvgFiles.mockImplementation(async (files, importObject, _pushToast, options) => {
      calls.order.push(`svg:${files[0].name}`);
      importObject(object(files[0].name), options.nextSuccessIndex());
    });
    calls.importDxfFiles.mockImplementation(async (files, ctx) => {
      calls.order.push(`dxf:${files[0].name}`);
      ctx.importObject(object(files[0].name), ctx.nextSuccessIndex());
    });
    calls.importImageFile.mockImplementation(async (file, importObject) => {
      calls.order.push(`image:${file.name}`);
      if (!file.name.startsWith('bad')) importObject(object(file.name));
    });
    calls.importStlFiles.mockImplementation(async (files, ctx) => {
      calls.order.push(`stl:${files[0].name}`);
      ctx.importObject(object(files[0].name), ctx.nextSuccessIndex());
    });
    const ctx = actions();

    await dispatchImportFilesInOrder(
      [
        new File([''], 'first.svg'),
        new File([''], 'bad.png', { type: 'image/png' }),
        new File([''], 'second.dxf'),
        new File([''], 'third.jpg', { type: 'image/jpeg' }),
        new File([''], 'fourth.stl'),
      ],
      ctx,
    );

    expect(calls.order).toEqual([
      'svg:first.svg',
      'image:bad.png',
      'dxf:second.dxf',
      'image:third.jpg',
      'stl:fourth.stl',
    ]);
    const vectorCalls = ctx.importSvgObject.mock.calls as unknown as ReadonlyArray<
      readonly [SceneObject, number]
    >;
    expect(vectorCalls.map(([obj, index]) => [obj.id, index])).toEqual([
      ['first.svg', 0],
      ['second.dxf', 1],
      ['fourth.stl', 3],
    ]);
    expect(ctx.importRasterImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'third.jpg' }),
      2,
    );
  });

  it('isolates an unexpected per-file failure and continues with the next original file', async () => {
    calls.importDxfFiles.mockRejectedValueOnce(new Error('parser crashed'));
    calls.importSvgFiles.mockImplementationOnce(
      async (files, importObject, _pushToast, options) => {
        calls.order.push(`svg:${files[0].name}`);
        importObject(object(files[0].name), options.nextSuccessIndex());
      },
    );
    const ctx = actions();

    await dispatchImportFilesInOrder(
      [new File([''], 'broken.dxf'), new File([''], 'survivor.svg')],
      ctx,
    );

    expect(ctx.pushToast).toHaveBeenCalledWith(
      'broken.dxf: import failed: parser crashed',
      'error',
    );
    expect(ctx.importSvgObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'survivor.svg' }),
      0,
    );
  });

  it('uses one unified picker and sends every supported format through the ordered dispatcher', async () => {
    calls.importSvgFiles.mockImplementation(async (files, importObject, _pushToast, options) => {
      calls.order.push(`svg:${files[0].name}`);
      importObject(object(files[0].name), options.nextSuccessIndex());
    });
    calls.importImageFile.mockImplementation(async (file, importObject) => {
      calls.order.push(`image:${file.name}`);
      importObject(object(file.name));
    });
    const pickFilesForOpen = vi.fn(async () => [
      { name: 'vector.svg', text: async (): Promise<string> => '<svg />' },
      {
        name: 'photo.png',
        text: async (): Promise<string> => '',
        blob: async () => new Blob(['png'], { type: 'image/png' }),
      },
    ]);
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen,
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    const ctx = actions();

    await handleUnifiedArtworkImport(platform, ctx);

    expect(pickFilesForOpen).toHaveBeenCalledWith({
      accept: ['.svg', '.dxf', '.png', '.jpg', '.jpeg', '.stl'],
      multiple: true,
    });
    expect(calls.order).toEqual(['svg:vector.svg', 'image:photo.png']);
    expect(ctx.importSvgObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'vector.svg' }),
      0,
    );
    expect(ctx.importRasterImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'photo.png' }),
      1,
    );
  });
});
