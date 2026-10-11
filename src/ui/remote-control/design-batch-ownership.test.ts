import { afterEach, beforeEach, expect, it } from 'vitest';
import { useStore, type AppState } from '../state/store';
import { addTestRectangle, resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = testAdapter();
});
afterEach(() => adapter.dispose());

async function fixture(action: string) {
  const ids = [await addTestRectangle(adapter), await addTestRectangle(adapter, 20)];
  if (action === 'ungroup') {
    useStore.getState().selectObjects(ids);
    useStore.getState().groupSelection();
  }
  useStore.getState().selectObjects([]);
  return ids;
}

it.each(['group', 'ungroup', 'duplicate'])(
  'batches %s in one reversible Undo entry',
  async (action) => {
    const ids = await fixture(action);
    const before = useStore.getState();
    const result = await adapter.execute(
      'apply_edits',
      writeArgs(adapter, {
        edits: [{ command: 'arrange_artwork', args: { artworkIds: ids, action } }],
      }),
    );
    expect(resultCode(result)).toBe('ok');
    const after = useStore.getState();
    expect(after.pendingUndo).toBeNull();
    expect(after.undoStack).toHaveLength(before.undoStack.length + 1);
    if (action === 'duplicate') expect(after.project.scene.objects).toHaveLength(4);
    else expect(after.project.scene.groups ?? []).toHaveLength(action === 'group' ? 1 : 0);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before.project);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after.project);
  },
);

it.each(['group', 'ungroup', 'duplicate'])(
  'rolls back %s if a later batch edit fails',
  async (action) => {
    const ids = await fixture(action);
    const before = useStore.getState();
    const result = await adapter.execute(
      'apply_edits',
      writeArgs(adapter, {
        edits: [
          { command: 'arrange_artwork', args: { artworkIds: ids, action } },
          { command: 'arrange_artwork', args: { artworkIds: ['missing'], action: 'delete' } },
        ],
      }),
    );
    expect(resultCode(result)).not.toBe('ok');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().selectedObjectId).toBe(before.selectedObjectId);
    expect(useStore.getState().pendingUndo).toBeNull();
  },
);

it.each(['document', 'interaction'] as const)(
  'does not cancel a replacement %s owner',
  async (replacement) => {
    const ids = await fixture('group');
    let replacementState: AppState | undefined;
    let armed = true;
    const unsubscribe = useStore.subscribe((state) => {
      if (!armed || state.selectedObjectId !== ids[0]) return;
      armed = false;
      if (replacement === 'document') state.newProject();
      useStore.getState().beginInteraction();
      replacementState = useStore.getState();
    });
    try {
      const result = await adapter.execute(
        'apply_edits',
        writeArgs(adapter, {
          edits: [{ command: 'arrange_artwork', args: { artworkIds: ids, action: 'group' } }],
        }),
      );
      expect(resultCode(result)).not.toBe('ok');
      expect(replacementState).toBeDefined();
      expect(useStore.getState().project).toBe(replacementState!.project);
      expect(useStore.getState().pendingUndo).toBe(replacementState!.pendingUndo);
      expect(useStore.getState().project.scene.groups ?? []).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  },
);

it('refuses a batch while a local interaction already owns Undo', async () => {
  const ids = await fixture('group');
  useStore.getState().beginInteraction();
  const before = useStore.getState();
  expect(
    resultCode(
      await adapter.execute(
        'apply_edits',
        writeArgs(adapter, {
          edits: [{ command: 'arrange_artwork', args: { artworkIds: ids, action: 'group' } }],
        }),
      ),
    ),
  ).toBe('busy');
  expect(useStore.getState()).toBe(before);
});

it('stops before the next edit when selecting opens a different document', async () => {
  const ids = await fixture('group');
  let armed = true;
  const unsubscribe = useStore.subscribe((state) => {
    if (!armed || state.selectedObjectId !== ids[0]) return;
    armed = false;
    state.newProject();
  });
  try {
    const result = await adapter.execute(
      'apply_edits',
      writeArgs(adapter, {
        edits: [
          { command: 'set_selection', args: { artworkIds: ids } },
          { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 } },
        ],
      }),
    );
    expect(resultCode(result)).toBe('stale_revision');
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().pendingUndo).toBeNull();
  } finally {
    unsubscribe();
  }
});

it('rolls back its own interaction when selection opens a file picker', async () => {
  const ids = await fixture('group');
  const before = useStore.getState();
  let armed = true;
  const unsubscribe = useStore.subscribe((state) => {
    if (!armed || state.selectedObjectId !== ids[0]) return;
    armed = false;
    state.claimProjectOpenRequest();
  });
  try {
    const result = await adapter.execute(
      'apply_edits',
      writeArgs(adapter, {
        edits: [{ command: 'arrange_artwork', args: { artworkIds: ids, action: 'group' } }],
      }),
    );
    expect(resultCode(result)).toBe('stale_revision');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().pendingUndo).toBeNull();
    expect(useStore.getState().projectOpenRequestEpoch).toBeGreaterThan(
      before.projectOpenRequestEpoch,
    );
  } finally {
    unsubscribe();
  }
});
