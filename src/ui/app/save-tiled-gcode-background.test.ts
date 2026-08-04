import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import type * as GcodeModule from '../../io/gcode';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
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
  it('acquires the first save target before awaiting the output worker', async () => {
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
        order.push('picker');
        suggestedNames.push(request.suggestedName);
        return target;
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

    expect(order).toEqual(['picker', 'worker', 'write']);
    expect(suggestedNames).toEqual(['mixed-tiles_tile-r1-c1.nc']);
    expect(mocks.prepareOutput).not.toHaveBeenCalled();
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
