import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import type * as GcodeModule from '../../io/gcode';
import type { PlatformAdapter, SaveDirectoryTarget, SaveTarget } from '../../platform/types';
import type * as OutputWorkerModule from '../laser/output-preparation-worker-client';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';
import { handleSaveTiledGcode } from './save-tiled-gcode';
import { capturingPlatform, tiledCncProject } from './save-tiled-gcode-testing';
import type * as TiledPreparationModule from './tiled-output-preparation';

const mocks = vi.hoisted(() => ({
  prepareOutput: vi.fn(),
  prepareTiledOutputOffThread: vi.fn(),
  finalizeTiledOutput: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('../../io/gcode', async (importActual) => ({
  ...(await importActual<typeof GcodeModule>()),
  prepareOutput: mocks.prepareOutput,
}));
vi.mock('../laser/output-preparation-worker-client', async (importActual) => ({
  ...(await importActual<typeof OutputWorkerModule>()),
  prepareTiledOutputOffThread: mocks.prepareTiledOutputOffThread,
}));
vi.mock('./tiled-output-preparation', async (importActual) => ({
  ...(await importActual<typeof TiledPreparationModule>()),
  finalizeTiledOutput: mocks.finalizeTiledOutput,
}));
vi.mock('../state/job-aware-dialogs', () => ({ jobAwareAlert: mocks.alert }));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('costly tiled output isolation', () => {
  it('reserves one directory before the worker and creates files only after preparation', async () => {
    const order: string[] = [];
    const suggestedNames: string[] = [];
    const target: SaveTarget = {
      displayName: 'mixed-tiles-first-tile.nc',
      write: async () => {
        order.push('write');
      },
    };
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async (request) => {
        order.push('fallback-picker');
        suggestedNames.push(request.suggestedName);
        return target;
      },
      reserveSaveDirectory: async (): Promise<SaveDirectoryTarget> => {
        order.push('directory');
        return {
          file: (name) => {
            order.push('file');
            suggestedNames.push(name);
            return target;
          },
        };
      },
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    mocks.prepareTiledOutputOffThread.mockImplementation(() => {
      order.push('worker');
      return Promise.resolve({
        kind: 'ready',
        files: [{ name: 'mixed-tiles-r1-c1', gcode: 'G21\n' }],
        machineWarnings: [],
        tileAdvisories: [],
        preparationAdvisories: [],
        emissionAdvisories: [],
      });
    });

    await handleSaveTiledGcode({
      platform,
      project: costlyTiledProject(),
      savedName: 'mixed-tiles',
      pushToast: () => undefined,
    });

    expect(order).toEqual(['directory', 'worker', 'file', 'write']);
    expect(suggestedNames).toEqual(['mixed-tiles-r1-c1.nc']);
    expect(mocks.prepareOutput).not.toHaveBeenCalled();
  });

  it('does not create a tile target when background preparation fails', async () => {
    const file = vi.fn((): SaveTarget => ({ displayName: 'tile.nc', write: vi.fn() }));
    const reserveSaveDirectory = vi.fn(async (): Promise<SaveDirectoryTarget> => ({ file }));
    mocks.prepareTiledOutputOffThread.mockReturnValueOnce(Promise.reject(new Error('failed')));

    await handleSaveTiledGcode({
      platform: {
        ...capturingPlatform([]),
        reserveSaveDirectory,
      },
      project: costlyTiledProject(),
      savedName: 'existing-tiles',
      pushToast: () => undefined,
    });

    expect(reserveSaveDirectory).toHaveBeenCalledOnce();
    expect(file).not.toHaveBeenCalled();
  });

  const cases: ReadonlyArray<readonly [string, () => null | Promise<never>]> = [
    ['worker unavailable', (): null => null],
    ['worker failed', (): Promise<never> => Promise.reject(new Error('worker failed'))],
  ];
  it.each(cases)(
    '%s never falls back to UI-side preparation or emission',
    async (_label, result) => {
      const project = costlyTiledProject();
      expect(costlyCanvasPreparation(project)).toBe(true);
      mocks.prepareTiledOutputOffThread.mockReturnValueOnce(result());
      const written: string[] = [];

      const handled = await handleSaveTiledGcode({
        platform: capturingPlatform(written),
        project,
        savedName: 'mixed-tiles',
        pushToast: () => undefined,
      });

      expect(handled).toBe(true);
      expect(mocks.prepareTiledOutputOffThread).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'tiles', project, savedName: 'mixed-tiles' }),
      );
      expect(mocks.prepareOutput).not.toHaveBeenCalled();
      expect(mocks.finalizeTiledOutput).not.toHaveBeenCalled();
      expect(written).toEqual([]);
      expect(mocks.alert).toHaveBeenCalledWith(expect.stringContaining('Background compilation'));
    },
  );
});

function costlyTiledProject() {
  const project = tiledCncProject();
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer, index) => ({
        ...layer,
        cnc: {
          ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
          cutType: index === 0 ? ('pocket' as const) : ('v-carve' as const),
          ...(index === 1 ? { toolId: 'vb-60' } : {}),
        },
      })),
    },
  };
}
