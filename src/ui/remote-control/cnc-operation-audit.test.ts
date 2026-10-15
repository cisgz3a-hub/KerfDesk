import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../core/scene';
import { setActiveEdition } from '../licensing/edition';
import { useStore } from '../state/store';
import { addTestRectangle, resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(async () => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter();
  await addTestRectangle(adapter);
  useStore.getState().setMachineKind('cnc');
});
afterEach(() => {
  adapter.dispose();
  setActiveEdition(null);
});

it('publishes the same effective CNC defaults as the PC for an unconfigured operation', async () => {
  expect(useStore.getState().project.scene.layers[0]!.cnc).toBeUndefined();
  const result = await adapter.execute('get_workspace', {});
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.data.operations).toEqual([
    expect.objectContaining({
      type: DEFAULT_CNC_LAYER_SETTINGS.cutType,
      cnc: expect.objectContaining({
        cutType: DEFAULT_CNC_LAYER_SETTINGS.cutType,
        depthMm: DEFAULT_CNC_LAYER_SETTINGS.depthMm,
        feedMmPerMin: DEFAULT_CNC_LAYER_SETTINGS.feedMmPerMin,
      }),
    }),
  ]);
});

it.each(['single', 'batch'] as const)(
  'applies settings to an unconfigured CNC operation (%s)',
  async (mode) => {
    const before = useStore.getState();
    const layer = before.project.scene.layers[0]!;
    expect(layer.cnc).toBeUndefined();
    const args = { operationId: layer.id, patch: { cnc: { depthMm: 2.5, feedMmPerMin: 731 } } };
    const result =
      mode === 'single'
        ? await adapter.execute('update_operation', writeArgs(adapter, args))
        : await adapter.execute(
            'apply_edits',
            writeArgs(adapter, { edits: [{ command: 'update_operation', args }] }),
          );
    expect(resultCode(result)).toBe('ok');
    expect(useStore.getState().project.scene.layers[0]!.cnc).toMatchObject({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: 2.5,
      feedMmPerMin: 731,
    });
    expect(useStore.getState().undoStack).toHaveLength(before.undoStack.length + 1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers[0]!.cnc).toBeUndefined();
  },
);

const automatic: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  materialKey: 'plywood-mdf',
  feedSource: { kind: 'material-recipe', materialKey: 'plywood-mdf', fluteCount: 2 },
};

it.each([
  { feedMmPerMin: 731 },
  { plungeMmPerMin: 125 },
  { spindleRpm: 9000 },
  { depthPerPassMm: 0.5 },
  { toolId: 'em-6350' },
])('keeps remote manual CNC settings from being treated as automatic: %j', async (patch) => {
  const layer = useStore.getState().project.scene.layers[0]!;
  useStore.getState().setLayerParam(layer.id, { cnc: automatic });
  const result = await adapter.execute(
    'update_operation',
    writeArgs(adapter, {
      operationId: layer.id,
      patch: { cnc: patch },
    }),
  );
  expect(resultCode(result)).toBe('ok');
  const current = useStore.getState().project.scene.layers[0]!.cnc;
  expect(current).toMatchObject({ ...patch, materialKey: 'plywood-mdf' });
  expect(current).not.toHaveProperty('feedSource');
  useStore.getState().undo();
  expect(useStore.getState().project.scene.layers[0]!.cnc).toEqual(automatic);
});

it('preserves automatic feeds when changing only the total cut depth', async () => {
  const layer = useStore.getState().project.scene.layers[0]!;
  useStore.getState().setLayerParam(layer.id, { cnc: automatic });
  const result = await adapter.execute(
    'update_operation',
    writeArgs(adapter, {
      operationId: layer.id,
      patch: { cnc: { depthMm: 2 } },
    }),
  );
  expect(resultCode(result)).toBe('ok');
  expect(useStore.getState().project.scene.layers[0]!.cnc).toEqual({ ...automatic, depthMm: 2 });
});

it('retains Pro admission when introducing a Pro strategy on an unconfigured operation', async () => {
  const requestPro = vi.fn(() => false);
  setActiveEdition({ status: null, licensed: true, pro: false, requestPro, openLicence: vi.fn() });
  const before = useStore.getState();
  const result = await adapter.execute(
    'update_operation',
    writeArgs(adapter, {
      operationId: before.project.scene.layers[0]!.id,
      patch: { cnc: { cutType: 'v-carve' } },
    }),
  );
  expect(resultCode(result)).toBe('needs_pro');
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().undoStack).toEqual(before.undoStack);
  expect(requestPro).not.toHaveBeenCalled();
});
