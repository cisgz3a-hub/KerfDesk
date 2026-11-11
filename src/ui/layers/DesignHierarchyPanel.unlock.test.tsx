// Annoyance audit A4-P2-3: a locked row in the artwork tree can be unlocked on
// its own, and its disabled name button says why it is disabled.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useDesignHierarchyStore } from '../state/design-hierarchy-store';
import { resetStore, svgObj } from '../state/test-helpers';
import { DesignHierarchyPanel } from './DesignHierarchyPanel';

let host: HTMLDivElement, root: Root;

beforeEach(async () => {
  resetStore();
  useDesignHierarchyStore.setState({ focusId: null, documentEpoch: -1 });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          { ...svgObj('A', ['#000000']), locked: true },
          { ...svgObj('B', ['#000000']), locked: true },
          svgObj('C', ['#000000']),
        ],
        groups: [{ id: 'pair', name: 'Letter pair', objectIds: ['A', 'B'] }],
      },
    },
    undoStack: [],
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<DesignHierarchyPanel />));
  const details = host.querySelector('details')!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function byLabel(label: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function byTitle(title: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((item) => item.title === title);
}

function lockedFlags(): ReadonlyArray<boolean> {
  return useStore.getState().project.scene.objects.map((object) => object.locked === true);
}

describe('unlocking one row of the artwork tree (A4-P2-3)', () => {
  it('offers Unlock on a group that holds locked artwork, and frees only that artwork', async () => {
    expect(byLabel('Unlock C')).toBeNull();
    const unlockGroup = byLabel('Unlock Letter pair');
    expect(unlockGroup?.title).toBe(
      'Unlock the locked artwork in Letter pair. Other locked artwork stays locked.',
    );

    await act(async () => unlockGroup?.click());

    expect(lockedFlags()).toEqual([false, false, false]);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(byLabel('Unlock Letter pair')).toBeNull();
    useStore.getState().undo();
    expect(lockedFlags()).toEqual([true, true, false]);
  });

  it('says why a locked row cannot be selected, then unlocks and selects that row alone', async () => {
    await act(async () => byTitle('Enter Letter pair to edit its children.')?.click());
    const name = byTitle('A is locked. Unlock it to select or edit it.');
    expect(name?.disabled).toBe(true);
    expect(byTitle('Select A directly for editing.')).toBeUndefined();

    await act(async () => byLabel('Unlock A')?.click());

    expect(lockedFlags()).toEqual([false, true, false]);
    expect(useStore.getState().selectedObjectId).toBe('A');
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(byTitle('Select A directly for editing.')?.disabled).toBe(false);
    expect(byLabel('Unlock A')).toBeNull();
    expect(byLabel('Unlock B')).not.toBeNull();
  });
});
