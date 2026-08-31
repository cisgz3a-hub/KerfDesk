import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Project, type SceneObject } from '../../core/scene';
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

function projectWithSharedObject(source: string): Project {
  const project = createProject();
  return {
    ...project,
    notes: source,
    scene: { ...project.scene, objects: [object('shared-id')] },
  };
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function actions() {
  return {
    getProjectDocumentEpoch: () => 0,
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

  it.each([
    {
      name: 'SVG',
      file: new File([''], 'late.svg'),
      arrange: (gate: { readonly promise: Promise<void> }) => {
        calls.importSvgFiles.mockImplementation(
          async (_files, importObject, pushToast, options) => {
            await gate.promise;
            try {
              importObject(object('shared-id'), options.nextSuccessIndex());
            } catch {
              pushToast('late SVG completion', 'error');
            }
          },
        );
      },
    },
    {
      name: 'DXF',
      file: new File([''], 'late.dxf'),
      arrange: (gate: { readonly promise: Promise<void> }) => {
        calls.importDxfFiles.mockImplementation(async (_files, ctx) => {
          await gate.promise;
          try {
            ctx.importObject(object('shared-id'), ctx.nextSuccessIndex());
          } catch {
            ctx.pushToast('late DXF completion', 'error');
          }
        });
      },
    },
    {
      name: 'raster image',
      file: new File([''], 'late.png', { type: 'image/png' }),
      arrange: (gate: { readonly promise: Promise<void> }) => {
        calls.importImageFile.mockImplementation(async (_file, importObject, pushToast) => {
          await gate.promise;
          try {
            importObject(object('shared-id'));
          } catch {
            pushToast('late raster completion', 'error');
          }
        });
      },
    },
    {
      name: 'STL',
      file: new File([''], 'late.stl'),
      arrange: (gate: { readonly promise: Promise<void> }) => {
        calls.importStlFiles.mockImplementation(async (_files, ctx) => {
          await gate.promise;
          try {
            ctx.importObject(object('shared-id'), ctx.nextSuccessIndex());
          } catch {
            ctx.pushToast('late STL completion', 'error');
          }
        });
      },
    },
  ])(
    'silently discards a late $name completion after a same-id replacement document opens',
    async ({ file, arrange }) => {
      const gate = deferred();
      arrange(gate);
      let epoch = 40;
      let currentProject = projectWithSharedObject('initiating document');
      const replacementProject = projectWithSharedObject('replacement document');
      const importSvgObject = vi.fn(() => ({ kind: 'added' as const }));
      const importRasterImage = vi.fn();
      const pushToast = vi.fn();

      const pending = dispatchImportFilesInOrder([file], {
        getProjectDocumentEpoch: () => epoch,
        importSvgObject,
        importRasterImage,
        pushToast,
      });
      currentProject = replacementProject;
      epoch += 1;
      gate.resolve();
      await pending;

      expect(currentProject).toBe(replacementProject);
      expect(currentProject.scene.objects[0]?.id).toBe('shared-id');
      expect(importSvgObject).not.toHaveBeenCalled();
      expect(importRasterImage).not.toHaveBeenCalled();
      expect(pushToast).not.toHaveBeenCalled();
    },
  );

  it('keeps a stale unified-picker failure silent after the document is replaced', async () => {
    const pick = deferred<ReadonlyArray<never>>();
    let epoch = 70;
    const pushToast = vi.fn();
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: () => pick.promise,
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    const pending = handleUnifiedArtworkImport(platform, {
      getProjectDocumentEpoch: () => epoch,
      importSvgObject: vi.fn(() => ({ kind: 'added' as const })),
      importRasterImage: vi.fn(),
      pushToast,
    });
    epoch += 1;
    pick.reject(new Error('late picker failure'));
    await pending;

    expect(pushToast).not.toHaveBeenCalled();
  });
});
