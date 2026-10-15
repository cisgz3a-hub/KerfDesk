import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { focusDesignHierarchy } from '../state/design-hierarchy-store';
import { addTestRectangle, resultCode, testAdapter, writeArgs } from './authoring-test-support';
import { selectedIds, workspaceProjection } from './projections';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  focusDesignHierarchy(null, useStore.getState().projectDocumentEpoch);
  adapter = testAdapter();
});
afterEach(() => adapter.dispose());

async function fixture(count = 4, groups: readonly (readonly number[])[] = [[0, 1]]) {
  await addTestRectangle(adapter);
  const state = useStore.getState();
  const source = state.project.scene.objects[0]!;
  const objects = Array.from({ length: count }, (_, index) => ({ ...source, id: `item-${index}` }));
  useStore.setState({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects,
        groups: groups.map((members, index) => ({
          id: `group-${index}`,
          name: `Group ${index}`,
          objectIds: members.map((member) => `item-${member}`),
        })),
      },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    dirty: false,
  });
  return objects.map((object) => object.id);
}

function select(mode: string, artworkIds?: string[]) {
  return adapter.execute(
    'set_selection',
    writeArgs(adapter, { mode, ...(artworkIds === undefined ? {} : { artworkIds }) }),
  );
}

describe('atomic remote selection modes', () => {
  it('keeps legacy replace and empty-array clear, without adding an Undo entry', async () => {
    const ids = await fixture();
    const before = useStore.getState();
    expect(
      await adapter.execute('set_selection', writeArgs(adapter, { artworkIds: [ids[0]] })),
    ).toMatchObject({ ok: true, data: { selection: ids.slice(0, 2) } });
    expect(
      await adapter.execute('set_selection', writeArgs(adapter, { artworkIds: [] })),
    ).toMatchObject({ ok: true, data: { selection: [] } });
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('adds and removes groups, and toggles repeated group siblings only once', async () => {
    const ids = await fixture();
    await select('replace', [ids[2]!]);
    expect(await select('add', [ids[1]!])).toMatchObject({
      ok: true,
      data: { selection: ids.slice(0, 3) },
    });
    expect(await select('remove', [ids[0]!])).toMatchObject({
      ok: true,
      data: { selection: [ids[2]] },
    });
    expect(await select('toggle', [ids[0]!, ids[1]!, ids[2]!])).toMatchObject({
      ok: true,
      data: { selection: ids.slice(0, 2) },
    });
    expect(await select('toggle', [ids[0]!, ids[1]!])).toMatchObject({
      ok: true,
      data: { selection: [] },
    });
  });

  it('expands overlapping groups transitively while ignoring local Edit-inside focus', async () => {
    const ids = await fixture(4, [
      [0, 1],
      [1, 2],
    ]);
    focusDesignHierarchy('group-0', useStore.getState().projectDocumentEpoch);
    useStore.getState().selectObjects([ids[3]!]);
    expect(selectedIds(useStore.getState())).toEqual([]);
    expect(await select('replace', [ids[3]!])).toMatchObject({
      ok: true,
      data: { selection: [ids[3]] },
    });
    expect(await select('toggle', [ids[0]!, ids[2]!])).toMatchObject({
      ok: true,
      data: { selection: ids },
    });
    expect(await select('remove', [ids[1]!])).toMatchObject({
      ok: true,
      data: { selection: [ids[3]] },
    });
  });

  it('does not expand an untouched partial native group during add or remove', async () => {
    const ids = await fixture();
    focusDesignHierarchy('group-0', useStore.getState().projectDocumentEpoch);
    useStore.getState().selectObjects([ids[0]!]);
    expect(selectedIds(useStore.getState())).toEqual([ids[0]]);
    expect(await select('remove', [ids[3]!])).toMatchObject({
      ok: true,
      data: { selection: [ids[0]] },
    });
    expect(await select('add', [ids[3]!])).toMatchObject({
      ok: true,
      data: { selection: [ids[0], ids[3]] },
    });
    expect(await select('toggle', [ids[1]!])).toMatchObject({
      ok: true,
      data: { selection: [ids[0], ids[1], ids[3]] },
    });
    expect(await select('toggle', [ids[0]!, ids[1]!])).toMatchObject({
      ok: true,
      data: { selection: [ids[3]] },
    });
  });

  it.each(['locked', 'hidden', 'missing'] as const)(
    'excludes an entire %s group from all and refuses additions without a partial change',
    async (kind) => {
      const ids = await fixture();
      const state = useStore.getState();
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects
              .map((object) =>
                object.id !== ids[1]
                  ? object
                  : {
                      ...object,
                      ...(kind === 'locked' ? { locked: true } : {}),
                      ...(kind === 'hidden' ? { operationIds: ['hidden'] } : {}),
                    },
              )
              .filter((object) => kind !== 'missing' || object.id !== ids[1]),
            layers: [
              ...state.project.scene.layers,
              { ...state.project.scene.layers[0]!, id: 'hidden', visible: false },
            ],
          },
        },
      });
      expect(await select('all')).toMatchObject({ ok: true, data: { selection: ids.slice(2) } });
      const before = useStore.getState();
      const revision = adapter.getRevision();
      expect(resultCode(await select('add', [ids[0]!]))).toBe(
        kind === 'missing' ? 'not_found' : 'not_editable',
      );
      expect(useStore.getState()).toBe(before);
      expect(adapter.getRevision()).toBe(revision);
    },
  );

  it.each(['locked', 'hidden', 'private', 'missing'] as const)(
    'projects whole connected-unit eligibility with a %s member',
    async (kind) => {
      await fixture(4, [
        [0, 1],
        [1, 2],
      ]);
      const state = useStore.getState();
      const privateId = 'C:/private/source.svg';
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects
              .map((object) =>
                object.id === 'item-2'
                  ? {
                      ...object,
                      ...(kind === 'locked'
                        ? { locked: true }
                        : kind === 'hidden'
                          ? { operationIds: ['hidden'] }
                          : kind === 'private'
                            ? { id: privateId }
                            : {}),
                    }
                  : object,
              )
              .filter((object) => kind !== 'missing' || object.id !== 'item-2'),
            groups: state.project.scene.groups!.map((group) => ({
              ...group,
              objectIds: group.objectIds.map((id) =>
                kind === 'private' && id === 'item-2' ? privateId : id,
              ),
            })),
            layers: [
              ...state.project.scene.layers,
              { ...state.project.scene.layers[0]!, id: 'hidden', visible: false },
            ],
          },
        },
      });
      for (const sharing of [true, false]) {
        const projected = workspaceProjection(useStore.getState(), sharing);
        expect(
          projected.artwork.filter((item) => item.id !== 'item-3').every((item) => !item.editable),
        ).toBe(true);
        expect(projected.artwork.find((item) => item.id === 'item-3')?.editable).toBe(true);
        expect(JSON.stringify(projected)).not.toContain(privateId);
      }
    },
  );

  it('removes a newly locked group and clears a native oversized selection', async () => {
    const ids = await fixture(201, [Array.from({ length: 201 }, (_, index) => index)]);
    useStore.getState().selectObjects(ids);
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) => ({ ...object, locked: true })),
        },
      },
    });
    expect(await select('remove', [ids[0]!])).toMatchObject({ ok: true, data: { selection: [] } });
    useStore.setState({ selectedObjectId: ids[0]!, additionalSelectedIds: new Set(ids.slice(1)) });
    const workspace = await adapter.execute('get_workspace', {});
    expect(workspace).toMatchObject({
      ok: true,
      data: {
        totalSelected: 201,
        selectionTruncated: true,
        capabilities: { selectionModes: true },
      },
    });
    expect(workspace.ok && workspace.data['selection']).toHaveLength(200);
    expect(await select('clear')).toMatchObject({ ok: true, data: { selection: [] } });
  });

  it.each(['replace', 'all', 'add'])(
    'refuses %s when group expansion or union exceeds 200, retaining selection and output scope',
    async (mode) => {
      const ids = await fixture(
        201,
        mode === 'add' ? [] : [Array.from({ length: 201 }, (_, index) => index)],
      );
      useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
      if (mode === 'add') useStore.getState().selectObjects(ids.slice(0, 200));
      const before = useStore.getState();
      const revision = adapter.getRevision();
      const result = await select(
        mode,
        mode === 'all' ? undefined : [ids[mode === 'add' ? 200 : 0]!],
      );
      expect(resultCode(result)).toBe('unsupported_operation');
      expect(useStore.getState()).toBe(before);
      expect(adapter.getRevision()).toBe(revision);
    },
  );

  it('accepts exactly 200 and selects eligible artwork beyond the bounded workspace listing', async () => {
    const ids = await fixture(201, []);
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object, index) =>
            index === 0 ? { ...object, locked: true } : object,
          ),
        },
      },
    });
    expect(await select('all')).toMatchObject({ ok: true, data: { selection: ids.slice(1) } });
    expect(selectedIds(useStore.getState())).toContain(ids[200]);
  });

  it('replays a toggle once and fences new requests with obsolete selection revisions', async () => {
    const ids = await fixture();
    const request = writeArgs(adapter, { mode: 'toggle', artworkIds: [ids[0]] });
    const first = await adapter.execute('set_selection', request);
    expect(await adapter.execute('set_selection', request)).toEqual(first);
    expect(selectedIds(useStore.getState())).toEqual(ids.slice(0, 2));
    expect(
      resultCode(
        await adapter.execute('set_selection', { ...request, requestId: crypto.randomUUID() }),
      ),
    ).toBe('stale_revision');
    expect(resultCode(await adapter.execute('set_selection', { ...request, mode: 'remove' }))).toBe(
      'request_conflict',
    );
  });

  it('updates canonical selected-output scope and clears it with clear', async () => {
    const ids = await fixture();
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
    await select('replace', [ids[0]!]);
    expect(useStore.getState().project.jobSetup?.outputScope.selectedObjectIds).toEqual(
      ids.slice(0, 2),
    );
    expect(useStore.getState().dirty).toBe(true);
    await select('clear');
    expect(useStore.getState().project.jobSetup?.outputScope.selectedObjectIds).toEqual([]);
  });

  it('supports selection modes and created-artwork references inside an atomic batch', async () => {
    const ids = await fixture();
    await select('all');
    const result = await adapter.execute(
      'apply_edits',
      writeArgs(adapter, {
        edits: [
          { command: 'set_selection', args: { mode: 'clear' } },
          { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 2, heightMm: 3 } },
          { command: 'set_selection', args: { mode: 'add', artworkIds: ['$1', ids[0]] } },
        ],
      }),
    );
    expect(resultCode(result)).toBe('ok');
    expect(selectedIds(useStore.getState())).toEqual([
      ...ids.slice(0, 2),
      useStore.getState().project.scene.objects.at(-1)!.id,
    ]);
    const before = useStore.getState();
    const failure = await adapter.execute(
      'apply_edits',
      writeArgs(adapter, {
        edits: [
          { command: 'set_selection', args: { mode: 'clear' } },
          { command: 'set_selection', args: { mode: 'add', artworkIds: ['missing'] } },
        ],
      }),
    );
    expect(resultCode(failure)).toBe('not_found');
    expect(selectedIds(useStore.getState())).toEqual(selectedIds(before));
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });
});

for (const kind of ['locked', 'hidden'] as const) {
  for (const batch of [false, true]) {
    it.each(['add', 'remove', 'toggle'] as const)(
      'preserves untargeted ' +
        kind +
        ' selection and output scope during %s (' +
        (batch ? 'batch' : 'single') +
        ')',
      async (mode) => {
        const ids = await fixture(3, []);
        useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
        await select('replace', ids.slice(0, 2));
        const state = useStore.getState();
        useStore.setState({
          project: {
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object, index) =>
                index !== 0
                  ? object
                  : {
                      ...object,
                      ...(kind === 'locked' ? { locked: true } : { operationIds: ['hidden'] }),
                    },
              ),
              layers: [
                ...state.project.scene.layers,
                {
                  ...state.project.scene.layers[0]!,
                  id: 'hidden',
                  visible: false,
                },
              ],
            },
          },
        });
        const artworkIds = [ids[mode === 'add' ? 2 : 1]!];
        const expected = mode === 'add' ? ids : [ids[0]];
        const result = batch
          ? await adapter.execute(
              'apply_edits',
              writeArgs(adapter, {
                edits: [{ command: 'set_selection', args: { mode, artworkIds } }],
              }),
            )
          : await select(mode, artworkIds);
        expect(result).toMatchObject({ ok: true, data: { selection: expected } });
        expect(selectedIds(useStore.getState())).toEqual(expected);
        expect(useStore.getState().project.jobSetup?.outputScope.selectedObjectIds).toEqual(
          expected,
        );
      },
    );
  }
}
