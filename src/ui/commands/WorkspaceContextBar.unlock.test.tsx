// Annoyance audit A4-P2-3: a right-click on locked artwork offers Unlock for
// that one object.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { WorkspaceContextBar } from './WorkspaceContextBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useUiStore.getState().closeWorkspaceContextBar();
  useStore.getState().importSvgObject({ ...svgObj('A', ['#ff0000']), locked: true });
  useStore.getState().importSvgObject({ ...svgObj('B', ['#00ff00']), locked: true });
  useStore.setState({ undoStack: [] });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useUiStore.getState().closeWorkspaceContextBar();
});

async function renderBar(): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<WorkspaceContextBar commands={[]} />);
  });
  return host;
}

function unlockItem(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'Unlock',
  );
}

describe('WorkspaceContextBar on locked artwork (A4-P2-3)', () => {
  it('unlocks and selects the clicked object, leaves the rest locked, and closes', async () => {
    useUiStore.getState().openWorkspaceContextBar({
      x: 80,
      y: 90,
      context: 'workspace-empty',
      lockedObjectId: 'A',
    });
    const h = await renderBar();
    const unlock = unlockItem(h);
    if (unlock === undefined) throw new Error('Unlock item missing');
    // It is the first item, so the keyboard lands on it when the menu opens.
    expect(h.querySelector('[role="menuitem"]')).toBe(unlock);
    expect(document.activeElement).toBe(unlock);

    await act(async () => unlock.click());

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.locked === true)).toEqual([
      false,
      true,
    ]);
    expect(state.selectedObjectId).toBe('A');
    expect(state.undoStack).toHaveLength(1);
    expect(useUiStore.getState().workspaceContextBar).toBeNull();
  });

  it('offers no Unlock without a locked object under the pointer', async () => {
    useUiStore.getState().openWorkspaceContextBar({ x: 80, y: 90, context: 'workspace-empty' });
    expect(unlockItem(await renderBar())).toBeUndefined();
  });

  it('offers no Unlock once that object is no longer locked', async () => {
    useStore.getState().unlockObjects(['A']);
    useUiStore.getState().openWorkspaceContextBar({
      x: 80,
      y: 90,
      context: 'workspace-empty',
      lockedObjectId: 'A',
    });
    expect(unlockItem(await renderBar())).toBeUndefined();
  });
});
