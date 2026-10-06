import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { testAdapter, addTestRectangle, writeArgs, resultCode } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter();
});
afterEach(() => adapter.dispose());

describe('independent settings synchronization audit', () => {
  it('witnesses successful Save changing the published dirty field without changing the phone revision', async () => {
    await addTestRectangle(adapter);
    const before = adapter.getRevision();
    const state = useStore.getState();
    expect(state.dirty).toBe(true);
    expect(
      state.markSaved(
        { displayName: 'audited-project.lf2', write: async () => undefined },
        state.project,
        state.projectDocumentEpoch,
        state.projectSaveRequestEpoch,
      ),
    ).toBe(true);
    const result = await adapter.execute('get_workspace', {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Read failed');
    expect(result.data['dirty']).toBe(false);
    expect(adapter.getRevision()).toBe(before);
  });

  it('projects actual PC operation edits, rejects prior phone authority, then shares current Undo/Redo and New', async () => {
    await addTestRectangle(adapter);
    const operationId = useStore.getState().project.scene.layers[0]!.id;
    const oldWrite = writeArgs(adapter, { operationId, patch: { powerPercent: 55 } });
    useStore.getState().setLayerParam(operationId, { power: 81, speed: 3200, passes: 3 });
    expect(resultCode(await adapter.execute('update_operation', oldWrite))).toBe('stale_revision');
    let result = await adapter.execute('get_workspace', {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Read failed');
    expect(result.data['operations']).toEqual([
      expect.objectContaining({ powerPercent: 81, speedMmPerMin: 3200, passes: 3 }),
    ]);
    expect(
      resultCode(
        await adapter.execute(
          'update_operation',
          writeArgs(adapter, { operationId, patch: { powerPercent: 55 } }),
        ),
      ),
    ).toBe('ok');
    expect(useStore.getState().project.scene.layers[0]!.power).toBe(55);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.layers[0]!.power).toBe(81);
    useStore.getState().redo();
    expect(useStore.getState().project.scene.layers[0]!.power).toBe(55);
    const beforeNew = adapter.getRevision();
    useStore.getState().newProject();
    expect(adapter.getRevision()).not.toBe(beforeNew);
    result = await adapter.execute('get_workspace', {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Read failed');
    expect(result.data['artwork']).toEqual([]);
    expect(result.data['operations']).toEqual([]);
  });
});
