import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JointResizeDialogHost } from './JointResizeDialogHost';
import { jointResizeFixture } from '../state/joint-resize.test-fixture';
import { useStore } from '../state';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});
async function render() {
  const { project, object } = jointResizeFixture();
  useStore.setState({
    project,
    projectDocumentEpoch: 42,
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  const close = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<JointResizeDialogHost onClose={close} />));
  return { project, close };
}
function choice(): HTMLInputElement {
  return container!.querySelector('[aria-label="Detected receiving features"] input')!;
}
function applyButton(): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (button) => button.textContent === 'Apply selected openings',
  )!;
}
async function choose(): Promise<void> {
  const input = choice();
  input.checked = true;
  await act(async () => Simulate.change(input));
}
async function enter(label: string, value: string): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  input.value = value;
  await act(async () => Simulate.change(input));
}

describe('joint resize review', () => {
  it('starts unchecked, numbers detected geometry, resets intent after dimension changes and applies once', async () => {
    const { project, close } = await render();
    expect(choice().checked).toBe(false);
    expect(applyButton().disabled).toBe(true);
    expect(container!.querySelector('[aria-label="Feature 1"]')).not.toBeNull();
    await choose();
    expect(applyButton().disabled).toBe(false);
    expect(useStore.getState().project).toBe(project);
    await enter('Material thickness (mm)', '3.5');
    expect(choice().checked).toBe(false);
    expect(applyButton().disabled).toBe(true);
    await choose();
    await act(async () => Simulate.submit(container!.querySelector('form')!));
    expect(useStore.getState().undoStack).toEqual([project]);
    expect(useStore.getState().project.scene.objects[0]!.id).toBe('slot');
    expect(close).toHaveBeenCalledOnce();
  });
  it('disables acceptance after document/selection drift and does not apply a stale submitted form', async () => {
    const { project } = await render();
    await choose();
    await act(async () => useStore.setState({ projectDocumentEpoch: 43 }));
    expect(applyButton().disabled).toBe(true);
    await act(async () => Simulate.submit(container!.querySelector('form')!));
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(container!.textContent).toContain('Artwork or selection changed');
  });
  it('shows unsafe geometry errors before changing the source', async () => {
    const { project } = await render();
    await enter('Material thickness (mm)', '50');
    await choose();
    expect(applyButton().disabled).toBe(true);
    expect(container!.textContent).toContain('collapses or crosses');
    expect(useStore.getState().project).toBe(project);
  });
});
