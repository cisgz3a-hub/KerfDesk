import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate, type SyntheticEventData } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type SceneGroup } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { resetStore, svgObj } from '../state/test-helpers';
import { useStore } from '../state';
import { useDesignHierarchyStore } from '../state/design-hierarchy-store';
import { DesignHierarchyPanel } from './DesignHierarchyPanel';

let host: HTMLDivElement, root: Root;
function seed(
  groups: ReadonlyArray<SceneGroup> = [
    { id: 'outer', name: 'Outer', objectIds: ['A', 'B', 'C', 'D', 'E'] },
    { id: 'child', name: 'Child', objectIds: ['A', 'B', 'C'], parentId: 'outer' },
    { id: 'target', name: 'Target', objectIds: ['F', 'G'] },
  ],
): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        groups,
        objects: [...'ABCDEFGH'].map((id) => svgObj(id, ['#000000'])),
        artworkOrder: [...'HGFEDCBA'],
      },
    },
  });
}
beforeEach(async () => {
  resetStore();
  useDesignHierarchyStore.setState({ focusId: null, documentEpoch: -1 });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  seed();
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
function element<T extends HTMLElement>(selector: string): T {
  const found = host.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing ${selector}`);
  return found;
}
function namedButton(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((button) => button.textContent === name);
  if (found === undefined) throw new Error(name);
  return found;
}
function dragData(): DataTransfer {
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    types: ['application/x-kerfdesk-design-node'],
  } as unknown as DataTransfer;
}
function dragEvent(
  dataTransfer: DataTransfer,
): SyntheticEventData & { readonly dataTransfer: DataTransfer } {
  return { dataTransfer };
}
async function start(name: string, data: DataTransfer): Promise<void> {
  await act(async () =>
    Simulate.dragStart(element(`[aria-label="Drag ${name}"]`), dragEvent(data)),
  );
}
async function choose(name: string, destination: string, position = 'last'): Promise<void> {
  await act(async () => element(`[aria-label="Move ${name}"]`).click());
  const select = element<HTMLSelectElement>('[aria-label="Design move destination"]');
  expect(document.activeElement).toBe(select);
  await act(async () => {
    select.value = destination;
    Simulate.change(select);
  });
  const positionSelect = element<HTMLSelectElement>('[aria-label="Design move position"]');
  await act(async () => {
    positionSelect.value = position;
    Simulate.change(positionSelect);
  });
  await act(async () => namedButton('Apply move').click());
}
describe('hierarchy drag and accessible transfers', () => {
  it('drags a group into another group as one persistent Undo/Redo edit', async () => {
    const before = useStore.getState().project,
      data = dragData();
    await start('Child', data);
    expect(data.setData).toHaveBeenCalledWith('application/x-kerfdesk-design-node', 'group:child');
    await act(async () =>
      Simulate.drop(element('[data-design-drop="group:target"]'), dragEvent(data)),
    );
    const after = useStore.getState().project;
    expect(after.scene.groups?.find((group) => group.id === 'child')?.parentId).toBe('target');
    expect(after.scene.groups?.find((group) => group.id === 'outer')?.objectIds).toEqual([
      'D',
      'E',
    ]);
    expect(after.scene.objects).toBe(before.scene.objects);
    expect(after.scene.artworkOrder).toBe(before.scene.artworkOrder);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(deserializeProject(serializeProject(after)).kind).toBe('ok');
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(before);
    await act(async () => useStore.getState().redo());
    expect(useStore.getState().project).toBe(after);
  });
  it('drops artwork between root siblings and promotes a group through the root target', async () => {
    const before = useStore.getState().project,
      data = dragData();
    await start('H', data);
    await act(async () =>
      Simulate.drop(element('[data-design-edge="before:group:outer"]'), dragEvent(data)),
    );
    expect(element<HTMLLIElement>('li').dataset['designNode']).toBe('object:H');
    expect(useStore.getState().project.scene.objects).toBe(before.scene.objects);
    await start('H', data);
    await act(async () =>
      Simulate.drop(element('[data-design-edge="after:group:outer"]'), dragEvent(data)),
    );
    expect(
      element('[data-design-node="group:target"]').previousElementSibling?.getAttribute(
        'data-design-node',
      ),
    ).toBe('object:H');
    expect(
      useStore.getState().project.scene.groups?.some((group) => group.objectIds.includes('H')),
    ).toBe(false);
    await start('Child', data);
    await act(async () => Simulate.drop(element('[data-design-root-drop]'), dragEvent(data)));
    expect(
      useStore.getState().project.scene.groups?.find((group) => group.id === 'child')?.parentId,
    ).toBeUndefined();
    expect(
      useStore.getState().project.scene.groups?.find((group) => group.id === 'outer')?.objectIds,
    ).toEqual(['D', 'E']);
  });
  it('moves individual artwork and mixed sibling order from keyboard-accessible selects', async () => {
    await choose('C', 'target', 'first');
    expect(
      useStore.getState().project.scene.groups?.find((group) => group.id === 'child')?.objectIds,
    ).toEqual(['A', 'B']);
    const target = element('[data-design-node="group:target"]');
    expect(target.nextElementSibling?.getAttribute('data-design-node')).toBe('object:C');
    await choose('H', '', 'group:outer');
    expect(element<HTMLLIElement>('li').dataset['designNode']).toBe('object:H');
    expect(host.querySelector('fieldset')).toBeNull();
  });
  it('explains singleton rejection, preserving all state while another valid move remains usable', async () => {
    await act(async () => seed([{ id: 'pair', name: 'Pair', objectIds: ['A', 'B'] }]));
    const before = useStore.getState();
    await choose('A', '');
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'leave “Pair” with 1 artwork',
    );
    expect(useStore.getState()).toBe(before);
    await act(async () => namedButton('Cancel move').click());
    await choose('H', 'pair');
    expect(useStore.getState().project.scene.groups?.[0]?.objectIds).toEqual(['A', 'B', 'H']);
  });
  it('rejects stale drops and ignores foreign drops without an owned drag', async () => {
    const data = dragData();
    const original = useStore.getState();
    await act(async () =>
      Simulate.drop(element('[data-design-drop="group:target"]'), dragEvent(data)),
    );
    expect(useStore.getState()).toBe(original);
    await start('H', data);
    await act(async () => useStore.getState().renameArtwork('A', 'Edited A'));
    const before = useStore.getState();
    await act(async () =>
      Simulate.drop(element('[data-design-drop="group:target"]'), dragEvent(data)),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain('project changed');
    expect(useStore.getState()).toBe(before);
  });
  it('disables locked drag/move controls, excludes cyclic targets and cancels from Escape', async () => {
    await act(async () =>
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object) =>
              object.id === 'A' ? { ...object, locked: true } : object,
            ),
          },
        },
      })),
    );
    expect(element<HTMLButtonElement>('[aria-label="Drag Child"]').disabled).toBe(true);
    expect(element<HTMLButtonElement>('[aria-label="Move A"]').disabled).toBe(true);
    const moveButton = element('[aria-label="Move Target"]');
    await act(async () => {
      moveButton.focus();
      moveButton.click();
    });
    const select = element<HTMLSelectElement>('[aria-label="Design move destination"]');
    expect([...select.options].map((option) => option.value)).not.toContain('target');
    const before = useStore.getState();
    await act(async () => Simulate.keyDown(select, { key: 'Escape' }));
    expect(host.querySelector('fieldset')).toBeNull();
    expect(document.activeElement).toBe(moveButton);
    expect(useStore.getState()).toBe(before);
  });
});
