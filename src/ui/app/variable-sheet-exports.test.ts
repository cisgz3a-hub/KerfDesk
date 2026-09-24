import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import type { OutputPreparationRequest } from '../laser/output-preparation-protocol';
import type * as WorkerClient from '../laser/output-preparation-worker-client';
import { prepareOutputRequest } from '../laser/output-preparation';
import { applyArraySelection } from '../state/array-actions';
import { prepareVariableArray } from '../state/prepare-variable-array';
import { useStore } from '../state/store';
import {
  fixtureState,
  GRID,
  NAMES,
  NOW,
  renderFixture,
} from '../state/variable-array-test-fixture';
import { handleSaveGcode } from './file-actions';

const mocks = vi.hoisted(() => ({ render: vi.fn(), worker: vi.fn(), alert: vi.fn() }));
vi.mock('../text/render-variable-text', () => ({
  renderVariableText: (input: unknown) => mocks.render(input),
}));
vi.mock('../state/job-aware-dialogs', () => ({ jobAwareAlert: mocks.alert }));
vi.mock('../laser/output-preparation-worker-client', async (importActual) => ({
  ...(await importActual<typeof WorkerClient>()),
  prepareSaveOutputOffThread: (request: unknown) => mocks.worker(request),
  prepareRdOutputOffThread: (request: unknown) => mocks.worker(request),
  prepareTiledOutputOffThread: (request: unknown) => mocks.worker(request),
}));

const initial = useStore.getState();
beforeEach(() => {
  mocks.render.mockReset().mockImplementation(renderFixture);
  mocks.alert.mockReset();
  mocks.worker.mockReset().mockImplementation(async (request: OutputPreparationRequest) => {
    const response = await prepareOutputRequest(request);
    if (!('result' in response)) throw new Error('No prepared result');
    return response.result;
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  useStore.setState(initial, true);
  vi.useRealTimers();
});

type Format = 'gcode' | 'rd' | 'tiles';
async function sheet(format: Format): Promise<Project> {
  const state = fixtureState();
  const prepared = await prepareVariableArray(state, GRID, {
    render: renderFixture,
    clock: () => NOW,
  });
  if (!prepared.ok) throw new Error(prepared.message);
  const project = {
    ...state,
    ...applyArraySelection(state, GRID, undefined, prepared.materialized),
  }.project;
  return {
    ...project,
    ...(format === 'rd' ? { device: { ...project.device, controllerKind: 'ruida' as const } } : {}),
    ...(format === 'tiles'
      ? {
          machine: {
            ...DEFAULT_CNC_MACHINE_CONFIG,
            tiling: {
              tileWidthMm: 60,
              tileHeightMm: 20,
              overlapMm: 0,
              registrationHoles: false,
            },
          },
        }
      : {}),
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({
        ...layer,
        ...(format === 'tiles'
          ? { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' as const } }
          : {}),
      })),
      // Cached editor geometry is deliberately stale: every export must evaluate.
      objects: project.scene.objects.map((object) =>
        object.kind === 'text' && object.variableTemplate !== undefined
          ? { ...object, content: 'stale', paths: [] }
          : object,
      ),
    },
  };
}

function platform(
  outcome: 'success' | 'cancel' | 'write-failure',
  writes: Array<string | Blob>,
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () =>
      outcome === 'cancel'
        ? null
        : {
            displayName: 'sheet',
            write: async (data) => {
              if (outcome === 'write-failure') throw new Error('disk full');
              writes.push(data);
            },
          },
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

describe('variable sheets across actual export actions', () => {
  it.each(['gcode', 'rd', 'tiles'] as const)(
    '%s advances only through the last selected copy',
    async (format) => {
      const project = await sheet(format);
      useStore.setState({ project });
      const selectedObjectIds = project.scene.objects.flatMap((object) =>
        object.kind === 'text' && [1, 3].includes(object.variableTemplate?.sequenceOffset ?? -1)
          ? [object.id]
          : [],
      );
      await handleSaveGcode({
        project,
        savedName: null,
        platform: platform('success', []),
        pushToast: vi.fn(),
        advanceVariablesAfter: useStore.getState().advanceVariablesAfter,
        outputScope: { cutSelectedGraphics: true, useSelectionOrigin: false, selectedObjectIds },
      });
      expect(mocks.alert).not.toHaveBeenCalled();
      expect(useStore.getState().project.variables).toMatchObject({
        serialValue: 14,
        recordIndex: 4,
      });
    },
  );
  for (const format of ['gcode', 'rd', 'tiles'] as const) {
    it.each(['success', 'cancel', 'write-failure'] as const)(
      `${format}: advances only after complete %s`,
      async (outcome) => {
        const project = await sheet(format);
        useStore.setState({ project });
        const writes: Array<string | Blob> = [];
        await handleSaveGcode({
          platform: platform(outcome, writes),
          project,
          savedName: null,
          advanceVariablesAfter: useStore.getState().advanceVariablesAfter,
          pushToast: vi.fn(),
        });
        expect(mocks.alert).not.toHaveBeenCalled();
        expect(useStore.getState().project.variables?.serialValue).toBe(
          outcome === 'success' ? 16 : 10,
        );
        if (outcome !== 'success') {
          expect(writes).toHaveLength(0);
          return;
        }
        expect(writes.length).toBeGreaterThan(0);
        expect(mocks.worker).toHaveBeenCalledOnce();
        expect(mocks.worker.mock.calls[0]?.[0]).toMatchObject({
          snapshot: { evaluatedAtIso: NOW.toISOString() },
        });
        const names = mocks.render.mock.calls
          .map(([input]) => input.content)
          .filter((value: string) => !value.startsWith('D1'));
        expect(names).toEqual(
          NAMES.map((name, index) => `${name}-${String(10 + index).padStart(3, '0')}`),
        );
      },
    );
  }

  it('does not consume a partially saved tile set', async () => {
    const project = await sheet('tiles');
    useStore.setState({ project });
    const writes: Array<string | Blob> = [];
    const adapter = platform('success', writes);
    let picked = 0;
    await handleSaveGcode({
      project,
      savedName: null,
      pushToast: vi.fn(),
      advanceVariablesAfter: useStore.getState().advanceVariablesAfter,
      platform: {
        ...adapter,
        pickFileForSave: async (request) =>
          ++picked === 2 ? null : adapter.pickFileForSave(request),
      },
    });
    expect(writes).toHaveLength(1);
    expect(picked).toBe(2);
    expect(useStore.getState().project).toBe(project);
  });

  it('retains captured output scope and leaves a replaced source untouched after a successful write', async () => {
    const project = await sheet('gcode');
    useStore.setState({ project });
    const selectedObjectIds = project.scene.objects.flatMap((object) =>
      object.kind === 'text' && [1, 3].includes(object.variableTemplate?.sequenceOffset ?? -1)
        ? [object.id]
        : [],
    );
    const outputScope = { cutSelectedGraphics: true, useSelectionOrigin: false, selectedObjectIds };
    const advance = vi.fn(useStore.getState().advanceVariablesAfter);
    const replacement = { ...project, notes: 'edited during save' };
    const adapter = platform('success', []);
    await handleSaveGcode({
      project,
      savedName: null,
      outputScope,
      pushToast: vi.fn(),
      advanceVariablesAfter: advance,
      platform: {
        ...adapter,
        pickFileForSave: async (request) => {
          useStore.setState({ project: replacement });
          return adapter.pickFileForSave(request);
        },
      },
    });
    expect(advance).toHaveBeenCalledExactlyOnceWith(project, 'successful-export', outputScope);
    expect(useStore.getState().project).toBe(replacement);
  });
});
