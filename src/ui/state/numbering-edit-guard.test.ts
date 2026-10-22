import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { editShortcutContext, transformShortcutContext } from '../app/shortcut-contexts';
import { handleEditShortcut, handleTransformShortcut } from '../app/shortcuts';
import { buildAppCommands, commandById, runCommand } from '../commands/command-registry';
import { baseCtx } from '../commands/command-registry-test-helpers';
import { deleteSelection } from '../commands/selection-delete-action';
import { useStore } from './index';
import { NUMBERING_EDIT_REFUSED_MESSAGE } from './numbering-edit-guard';
import { resetStore, svgObj } from './test-helpers';
import { useToastStore } from './toast-store';
import { useUiStore } from './ui-store';

// The Run order panel's Number on canvas / Done / Cancel, without the panel.
function startNumbering(): void {
  useStore.getState().beginInteraction();
  useUiStore
    .getState()
    .startArtworkNumbering(canonicalArtworkOrder(useStore.getState().project.scene));
}
function doneNumbering(): void {
  useStore.getState().endInteraction();
  useUiStore.getState().finishArtworkNumbering();
}
function cancelNumbering(): void {
  useStore.getState().cancelInteraction();
  useUiStore.getState().finishArtworkNumbering();
}

function objectIds(): ReadonlyArray<string> {
  return useStore.getState().project.scene.objects.map((object) => object.id);
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

function menuCommand(id: 'edit.delete' | 'edit.duplicate') {
  const app = useStore.getState();
  return commandById(
    buildAppCommands(
      baseCtx({
        hasSelection: true,
        deleteSelection: () => deleteSelection(),
        duplicateSelection: app.duplicateSelection,
      }),
    ),
    id,
  );
}

async function refusalToasts(): Promise<ReadonlyArray<string>> {
  await Promise.resolve();
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.message === NUMBERING_EDIT_REFUSED_MESSAGE)
    .map((toast) => toast.message);
}

beforeEach(() => {
  resetStore();
  useStore.getState().importSvgObject(svgObj('A', ['#000000']));
  useStore.getState().importSvgObject(svgObj('B', ['#000000']));
});

afterEach(() => {
  useUiStore.getState().resetArtworkRunOrder();
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
  resetStore();
});

describe('edits while canvas numbering is open', () => {
  it('does not dirty the rollback snapshot for a no-op that returns the full state', () => {
    useStore.setState({ dirty: false });
    const before = useStore.getState().project;
    startNumbering();
    useStore.getState().setRegistrationOutput('box'); // No registration layer exists.
    cancelNumbering();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('retains history-free placement and scope coherently when numbering is cancelled', async () => {
    useStore.setState({ dirty: false });
    const before = useStore.getState();
    startNumbering();
    useStore.getState().selectObjects(['A']);
    useStore.getState().setArtworkOrderDuringInteraction(['B', 'A']);
    useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'center' });
    useStore
      .getState()
      .setOutputScopeSettings({ cutSelectedGraphics: true, useSelectionOrigin: true });
    expect(await refusalToasts()).toHaveLength(0);
    cancelNumbering();
    const after = useStore.getState();
    expect(after.jobPlacement).toMatchObject({ startFrom: 'user-origin', anchor: 'center' });
    expect(after.outputScopeSettings).toMatchObject({
      cutSelectedGraphics: true,
      useSelectionOrigin: true,
    });
    expect(after.project.jobSetup?.placement).toEqual(after.jobPlacement);
    expect(after.project.jobSetup?.outputScope).toEqual({
      ...after.outputScopeSettings,
      selectedObjectIds: [before.selectedObjectId],
    });
    expect(canonicalArtworkOrder(after.project.scene)).toEqual(['A', 'B']);
    expect(after.selectedObjectId).toBe(before.selectedObjectId);
    expect(after.dirty).toBe(true);
  });

  it('refuses the Delete key and keeps the artwork through Cancel', async () => {
    const undoBefore = useStore.getState().undoStack;
    startNumbering();
    useStore.getState().selectObjects(['A']);

    expect(handleEditShortcut(key({ key: 'Delete' }), editShortcutContext())).toBe(true);

    expect(objectIds()).toEqual(['A', 'B']);
    expect(await refusalToasts()).toHaveLength(1);
    cancelNumbering();
    expect(objectIds()).toEqual(['A', 'B']);
    expect(useStore.getState().undoStack).toBe(undoBefore);
  });

  it.each(['edit.delete', 'edit.duplicate'] as const)(
    'refuses the %s menu and command-search command',
    async (id) => {
      startNumbering();
      useStore.getState().selectObjects(['B']);

      expect(runCommand(menuCommand(id))).toBe(true);

      expect(objectIds()).toEqual(['A', 'B']);
      expect(await refusalToasts()).toHaveLength(1);
      cancelNumbering();
      expect(objectIds()).toEqual(['A', 'B']);
    },
  );

  it('refuses an arrow-key nudge and shows one notice for repeated presses', async () => {
    startNumbering();
    useStore.getState().selectObjects(['A']);
    const before = useStore.getState().project;

    handleTransformShortcut(key({ key: 'ArrowRight' }), transformShortcutContext());
    handleTransformShortcut(key({ key: 'ArrowRight' }), transformShortcutContext());

    expect(useStore.getState().project).toBe(before);
    expect(await refusalToasts()).toHaveLength(1);
  });

  it('keeps Ctrl+Z from closing the numbering snapshot', async () => {
    startNumbering();
    const snapshot = useStore.getState().pendingUndo;
    useStore.getState().setArtworkOrderDuringInteraction(['B', 'A']);

    handleEditShortcut(key({ key: 'z', ctrlKey: true }), editShortcutContext());

    expect(useStore.getState().pendingUndo).toBe(snapshot);
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['B', 'A']);
    expect(await refusalToasts()).toHaveLength(1);
    cancelNumbering();
    expect(canonicalArtworkOrder(useStore.getState().project.scene)).toEqual(['A', 'B']);
  });

  it('still lets numbering order, select and commit its own step', () => {
    const undoBefore = useStore.getState().undoStack.length;
    startNumbering();
    useStore.getState().selectObjects(['B']);
    useStore.getState().setArtworkOrderDuringInteraction(['B', 'A']);
    doneNumbering();

    expect(useStore.getState().selectedObjectId).toBe('B');
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['B', 'A']);
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
  });

  it('applies the same Delete once numbering is done', async () => {
    startNumbering();
    doneNumbering();
    useStore.getState().selectObjects(['A']);

    handleEditShortcut(key({ key: 'Delete' }), editShortcutContext());

    expect(objectIds()).toEqual(['B']);
    expect(await refusalToasts()).toHaveLength(0);
  });

  it('does not guard an interaction that numbering does not own', async () => {
    useStore.getState().beginInteraction();
    useStore.getState().removeSceneObjects(['A']);

    expect(objectIds()).toEqual(['B']);
    expect(await refusalToasts()).toHaveLength(0);
  });
});
