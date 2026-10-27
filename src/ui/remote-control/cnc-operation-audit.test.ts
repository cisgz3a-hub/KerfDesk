import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../core/scene';
import { setActiveEdition } from '../licensing/edition';
import {
  cncStartupOperationDraft,
  sceneWithCncStartupOperationDrafts,
} from '../state/cnc-startup-setup';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
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

// A bit change is not a hand edit: it takes the Artwork card's path (below).
it.each([
  { feedMmPerMin: 731 },
  { plungeMmPerMin: 125 },
  { spindleRpm: 9000 },
  { depthPerPassMm: 0.5 },
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
  expect(current).toMatchObject(patch);
  expect(current).not.toHaveProperty('feedSource');
  // ADR-233 decision 5 (CNC audit v1 F4-P2-1): the material label goes too.
  expect(current).not.toHaveProperty('materialKey');
  useStore.getState().undo();
  expect(useStore.getState().project.scene.layers[0]!.cnc).toEqual(automatic);
});

// Rolling audit v4 H8-P2-1 (ADR-306 Amendment 4): the desktop twin is the Artwork card's
// transform, the Machine Setup tool plan's sceneWithCncStartupOperationDrafts.
function cardChoice(
  settings: CncLayerSettings,
  choice: { readonly toolId?: string; readonly materialKey?: string },
): CncLayerSettings {
  const state = useStore.getState();
  const machine = state.project.machine;
  if (machine?.kind !== 'cnc') throw new Error('Not a CNC project');
  const layer = { ...state.project.scene.layers[0]!, cnc: settings };
  const next = sceneWithCncStartupOperationDrafts({
    scene: { layers: [layer], objects: [] },
    machine,
    profile: state.project.device,
    liveCaps: state.cncLiveCaps,
    drafts: [{ ...cncStartupOperationDraft(layer), ...choice }],
  }).layers[0]!.cnc;
  if (next === undefined) throw new Error('No CNC settings');
  return next;
}

async function changeBit(mode: 'single' | 'batch', toolId: string) {
  const args = {
    operationId: useStore.getState().project.scene.layers[0]!.id,
    patch: { cnc: { toolId } },
  };
  return mode === 'single'
    ? adapter.execute('update_operation', writeArgs(adapter, args))
    : adapter.execute(
        'apply_edits',
        writeArgs(adapter, { edits: [{ command: 'update_operation', args }] }),
      );
}

describe('a remote bit change takes the Artwork card’s path', () => {
  it.each(['single', 'batch'] as const)(
    'recalculates a material-recipe operation for the new bit (%s)',
    async (mode) => {
      const layer = useStore.getState().project.scene.layers[0]!;
      // Hardwood with the 1/4" end mill, seeded by the card itself.
      const hardwood = cardChoice(DEFAULT_CNC_LAYER_SETTINGS, {
        toolId: 'em-6350',
        materialKey: 'hardwood',
      });
      useStore.getState().setLayerParam(layer.id, { cnc: hardwood });
      expect(hardwood.feedSource?.kind).toBe('material-recipe');
      const card = cardChoice(hardwood, { toolId: 'em-1588' });
      expect(card.feedMmPerMin).toBeLessThan(hardwood.feedMmPerMin);
      expect(card.depthPerPassMm).toBeLessThan(hardwood.depthPerPassMm);

      useToastStore.setState({ toasts: [] });
      const result = await changeBit(mode, 'em-1588');
      expect(resultCode(result)).toBe('ok');
      expect(useStore.getState().project.scene.layers[0]!.cnc).toEqual(card);
      // Recalculated values keep nothing from the old bit, so nothing is named.
      if (!result.ok) throw new Error(result.error.code);
      expect(JSON.stringify(result.data)).not.toContain('Kept from the previous bit');
      expect(useToastStore.getState().toasts).toEqual([]);
      useStore.getState().undo();
      expect(useStore.getState().project.scene.layers[0]!.cnc).toEqual(hardwood);
    },
  );

  // Rolling audit v5 J3-P2-2 (ADR-306 Amendment 5): the batch item carries the message through
  // the MCP output schema, and the PC shows it in both routes.
  it.each(['single', 'batch'] as const)(
    'keeps a manual operation’s values and names them, as the card’s note does (%s)',
    async (mode) => {
      const layer = useStore.getState().project.scene.layers[0]!;
      const manual: CncLayerSettings = {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        toolId: 'em-6350',
        feedMmPerMin: 2400,
        plungeMmPerMin: 960,
        spindleRpm: 12000,
        depthPerPassMm: 2.5,
      };
      useStore.getState().setLayerParam(layer.id, { cnc: manual });
      useToastStore.setState({ toasts: [] });
      const result = await changeBit(mode, 'em-1588');
      expect(resultCode(result)).toBe('ok');
      expect(useStore.getState().project.scene.layers[0]!.cnc).toEqual(
        cardChoice(manual, { toolId: 'em-1588' }),
      );
      expect(useStore.getState().project.scene.layers[0]!.cnc).toMatchObject({
        toolId: 'em-1588',
        feedMmPerMin: 2400,
        depthPerPassMm: 2.5,
      });
      if (!result.ok) throw new Error(result.error.code);
      const receipt = { ...result.data, revision: result.revision };
      const parsed =
        mode === 'single'
          ? mcpOutputSchemas.update_operation.parse(receipt)
          : mcpOutputSchemas.apply_edits.parse(receipt).results?.[0];
      const message = (parsed as { message?: string } | undefined)?.message;
      expect(message).toMatch(
        /^Bit changed\. Kept from the previous bit: feed 2400 mm\/min, plunge 960 mm\/min, spindle 12,000 RPM, depth per pass 2\.5 mm\. Check them for .+ before cutting\.$/,
      );
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ message, variant: 'warning' }),
      ]);
    },
  );

  it('refuses a bit that is not in the Machine Setup library', async () => {
    const before = useStore.getState();
    expect(resultCode(await changeBit('single', 'no-such-bit'))).toBe('invalid_arguments');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toEqual(before.undoStack);
  });
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
