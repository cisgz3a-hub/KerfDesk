import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  registrationRunState,
  type Project,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
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
vi.mock('./JigArtworkImport', () => ({
  JigArtworkImport: () => <div>Import artwork</div>,
  useJigArtworkImport: () => ({ busy: false, importFiles: async () => undefined }),
}));
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
function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((item) => item.textContent === label);
}
function click(label: string): void {
  const found = button(label);
  if (found === undefined) throw new Error(`Missing ${label}`);
  act(() => found.click());
}
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const editor = container.querySelector('[aria-label="Registration Jig editor"]');
  if (editor === null) throw new Error('Missing editor');
  const event = new KeyboardEvent('keydown', { ...init, key, bubbles: true, cancelable: true });
  act(() => {
    editor.dispatchEvent(event);
  });
  return event;
}
function confirmDialog(): Element | undefined {
  return [...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
    dialog.textContent?.includes('Save jig changes?'),
  );
}
function savedJigWithArtwork(): void {
  useStore.getState().addRegistrationBox(80, 40);
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    }),
  );
  useStore.getState().setRegistrationBoxLocked(true);
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
  it('opens on the editor surface so Enter cannot press Close or Save', () => {
    render();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Registration Jig editor');
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
  it('asks before discarding unsaved edits, and Keep editing keeps them', () => {
    savedJigWithArtwork();
    const project = useStore.getState().project;
    render();
    click('Remove outline');
    click('Close without saving');
    expect(confirmDialog()).toBeDefined();
    expect(close).not.toHaveBeenCalled();
    click('Keep editing');
    expect(confirmDialog()).toBeUndefined();
    expect(container.textContent).toContain('Unsaved changes');
    click('Close without saving');
    click('Discard changes');
    expect(close).toHaveBeenCalledOnce();
    expect(useStore.getState().project).toBe(project);
  });
  it('saves from the close prompt', () => {
    savedJigWithArtwork();
    render();
    click('Remove outline');
    click('Close without saving');
    const dialog = confirmDialog();
    const save = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent === 'Save to canvas',
    );
    act(() => save?.click());
    expect(close).toHaveBeenCalledOnce();
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toHaveLength(0);
  });
  it('Escape clears the selection first, then asks before discarding edits', () => {
    savedJigWithArtwork();
    useStore.getState().selectObject('art');
    render();
    press('ArrowRight');
    expect(container.textContent).toContain('Unsaved changes');
    press('Escape');
    expect(confirmDialog()).toBeUndefined();
    expect(close).not.toHaveBeenCalled();
    press('Escape');
    expect(confirmDialog()).toBeDefined();
    expect(close).not.toHaveBeenCalled();
  });
  it('Ctrl+A selects all the artwork but no outline, and not from a field', () => {
    savedJigWithArtwork();
    useStore.getState().drawShape(
      createRectangle({
        id: 'more',
        color: '#0000ff',
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 40, y: 5 },
      }),
    );
    useStore.getState().selectObject('art');
    render();
    const field = container.querySelector<HTMLInputElement>('[aria-label="X (mm)"]');
    if (field === null) throw new Error('Missing selection field');
    act(() => field.focus());
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    });
    expect(container.textContent).toContain('1 selected');
    expect(press('a', { ctrlKey: true }).defaultPrevented).toBe(true);
    // The outline has not been burned, so it is editable, but Ctrl+A leaves it out.
    expect(container.textContent).toContain('2 selected');
  });
  it('Escape in a field only leaves the field', () => {
    savedJigWithArtwork();
    useStore.getState().selectObject('art');
    render();
    const field = container.querySelector<HTMLInputElement>('[aria-label="X (mm)"]');
    if (field === null) throw new Error('Missing selection field');
    act(() => field.focus());
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Registration Jig editor');
    expect(container.textContent).toContain('1 selected');
    expect(confirmDialog()).toBeUndefined();
    expect(close).not.toHaveBeenCalled();
  });
  it('closes without a new undo step when nothing changed', () => {
    savedJigWithArtwork();
    const project = useStore.getState().project;
    const undo = useStore.getState().undoStack.length;
    render();
    click('Save to canvas');
    expect(close).toHaveBeenCalledOnce();
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(undo);
  });
  it('keeps burned outlines locked in Artwork only until they are unlocked', () => {
    savedJigWithArtwork();
    useStore.getState().setRegistrationOutput('artwork');
    expect(registrationRunState(useStore.getState().project.scene)).toBe('artwork');
    render();
    click('Jig layout');
    expect(container.querySelector('.lf-jig-lock')?.textContent).toContain('locked');
    expect(button('Select all outlines')?.disabled).toBe(true);
    click('Unlock outlines');
    expect(container.querySelector('.lf-jig-lock')).toBeNull();
    expect(button('Select all outlines')?.disabled).toBe(false);
    click('Undo');
    expect(container.querySelector('.lf-jig-lock')).not.toBeNull();
  });
  it('does not overwrite a different project opened behind the editor', () => {
    render();
    act(() => useStore.getState().newProject());
    const project = useStore.getState().project;
    click('Save to canvas');
    expect(useStore.getState().project).toBe(project);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'A different project was opened',
    );
    expect(close).not.toHaveBeenCalled();
  });
  it('saves the draft over an unrelated change made behind the editor', () => {
    render();
    act(() => useStore.getState().setVariableSettings({ serialValue: 5 }));
    click('Save to canvas');
    const { project } = useStore.getState();
    expect(close).toHaveBeenCalledOnce();
    expect(findRegistrationBoxes(project.scene)).toHaveLength(1);
    expect(project.variables?.serialValue).toBe(5);
  });
});
