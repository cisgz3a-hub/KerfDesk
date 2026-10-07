import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { serializeProject, deserializeProject } from '../../io/project';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useDesignHierarchyStore } from '../state/design-hierarchy-store';
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
        objects: ['A', 'B', 'C'].map((id) => svgObj(id, ['#000000'])),
        groups: [
          { id: 'outer', name: 'Sign assembly', objectIds: ['A', 'B', 'C'] },
          { id: 'child', name: 'Letter pair', objectIds: ['A', 'B'], parentId: 'outer' },
        ],
      },
    },
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
function button(title: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.title === title);
  if (found === undefined) throw new Error(title);
  return found;
}
describe('design hierarchy panel', () => {
  it('navigates into a group, selects a child deliberately and returns to its parent', async () => {
    const before = useStore.getState().project;
    await act(async () => button('Enter Sign assembly to edit its children.').click());
    expect(useDesignHierarchyStore.getState().focusId).toBe('outer');
    await act(async () => button('Enter Letter pair to edit its children.').click());
    await act(async () => button('Select A directly for editing.').click());
    expect(useStore.getState().selectedObjectId).toBe('A');
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    expect(host.querySelectorAll('li')).toHaveLength(2);
    await act(async () => button('Return to the parent design group.').click());
    expect(useDesignHierarchyStore.getState().focusId).toBe('outer');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
  it('commits a name from the keyboard as one undoable persistent edit', async () => {
    const before = useStore.getState().project;
    await act(async () => button('Rename A.').click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Design name"]')!;
    await act(async () => {
      input.value = 'Front lettering';
      Simulate.change(input);
    });
    await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
    expect(useStore.getState().undoStack).toHaveLength(1);
    const loaded = deserializeProject(serializeProject(useStore.getState().project));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.project.scene.objects[0]?.name).toBe('Front lettering');
    expect(host.querySelector('[aria-label="Design name"]')).toBeNull();
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
});
