import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findRegistrationBoxes, registrationRunState, type Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useUiStore } from '../../state/ui-store';
import { RegistrationJigEditor } from './RegistrationJigEditor';

vi.mock('./RegistrationJigCanvas', () => ({
  RegistrationJigCanvas: (props: { project: Project }) => (
    <div aria-label="Registration jig editing canvas">
      {findRegistrationBoxes(props.project.scene).length} outlines
    </div>
  ),
}));
vi.mock('./JigArtworkImport', () => ({ JigArtworkImport: () => <div>Import artwork</div> }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const close = vi.fn();
beforeEach(() => {
  useStore.getState().newProject();
  close.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function render(): void {
  act(() => root.render(<RegistrationJigEditor onClose={close} />));
}
function click(label: string): void {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`Missing ${label}`);
  act(() => found.click());
}
describe('Registration Jig dedicated editor', () => {
  it('starts with an editable draft and isolates application shortcuts', () => {
    const project = useStore.getState().project;
    const depth = useUiStore.getState().modalDepth;
    render();
    expect(
      container.querySelector('[aria-label="Registration jig editing canvas"]')?.textContent,
    ).toBe('1 outlines');
    expect(useStore.getState().project).toBe(project);
    expect(useUiStore.getState().modalDepth).toBe(depth + 1);
  });
  it('saves the first outline job in one undo step and locks the main guides', () => {
    render();
    click('Save to canvas');
    expect(registrationRunState(useStore.getState().project.scene)).toBe('box');
    expect(findRegistrationBoxes(useStore.getState().project.scene)[0]?.locked).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
  });
  it('close without saving leaves the project unchanged', () => {
    const project = useStore.getState().project;
    render();
    click('Close without saving');
    expect(useStore.getState().project).toBe(project);
    expect(close).toHaveBeenCalledOnce();
  });
  it('does not overwrite a project changed behind the editor', () => {
    render();
    act(() => useStore.getState().newProject());
    const project = useStore.getState().project;
    click('Save to canvas');
    expect(useStore.getState().project).toBe(project);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'main project changed',
    );
    expect(close).not.toHaveBeenCalled();
  });
});
