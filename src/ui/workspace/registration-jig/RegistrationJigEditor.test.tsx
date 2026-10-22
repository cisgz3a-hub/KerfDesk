import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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
      {findRegistrationBoxes(props.project.scene).length} outlines,{' '}
      {props.project.scene.objects.map((object) => object.id).join(' ')}
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
function square(id: string, x: number, y: number): void {
  useStore.getState().drawShape(
    createRectangle({
      id,
      color: '#0000ff',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y },
    }),
  );
}
/** Artwork at this offset from the bed centre, where the first outline is centred. */
function squareOnOutline(id: string, dx = 0): void {
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  square(id, bedWidth / 2 - 5 + dx, bedHeight / 2 - 5);
}
function savedJigWithArtwork(): void {
  useStore.getState().addRegistrationBox(80, 40);
  squareOnOutline('art');
  useStore.getState().setRegistrationBoxLocked(true);
}
function canvasText(): string | null | undefined {
  return container.querySelector('[aria-label="Registration jig editing canvas"]')?.textContent;
}
describe('Registration Jig dedicated editor', () => {
  it('starts with an editable draft and isolates application shortcuts', () => {
    const project = useStore.getState().project;
    const depth = useUiStore.getState().modalDepth;
    render();
    expect(canvasText()).toBe('1 outlines, registration-box');
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
    render();
    press('a', { ctrlKey: true });
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
    squareOnOutline('more', 20);
    // Main-canvas artwork off the jig is never part of Select all.
    square('main', 5, 5);
    render();
    click('Jig layout');
    click('Select all outlines');
    const field = container.querySelector<HTMLInputElement>('[aria-label="X (mm)"]');
    if (field === null) throw new Error('Missing selection field');
    act(() => field.focus());
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    });
    expect(container.textContent).toContain('1 selected');
    expect(press('a', { ctrlKey: true }).defaultPrevented).toBe(true);
    // The outline has not been burned, so it is editable, but Ctrl+A leaves it out,
    // and the main-canvas artwork is not on the jig canvas at all.
    expect(container.textContent).toContain('2 selected');
    expect(canvasText()).not.toContain('main');
  });
  it('Escape in a field only leaves the field', () => {
    savedJigWithArtwork();
    render();
    press('a', { ctrlKey: true });
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
  it.each(['X (mm)', 'Width (mm)'])('Escape in %s discards the typed value', (label) => {
    savedJigWithArtwork();
    render();
    press('a', { ctrlKey: true });
    const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
    if (field === null) throw new Error(`Missing ${label}`);
    const shown = field.value;
    act(() => field.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '42');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Registration Jig editor');
    expect(container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value).toBe(shown);
    expect(container.textContent).not.toContain('Unsaved changes');
  });
  it('leaves a value being composed with an IME alone on Escape', () => {
    savedJigWithArtwork();
    render();
    // The editor opens on a clean canvas (ADR-652): it never takes over the
    // main canvas selection, so select inside it.
    press('a', { ctrlKey: true });
    const field = container.querySelector<HTMLInputElement>('[aria-label="X (mm)"]');
    if (field === null) throw new Error('Missing selection field');
    act(() => field.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '42');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('42');
  });
  it('Enter in a field applies the value and keeps focus on the editor', async () => {
    // Laid out as in a browser, so the editor's focus recovery can pick a button.
    const laidOut = vi
      .spyOn(HTMLElement.prototype, 'offsetParent', 'get')
      .mockReturnValue(document.body);
    onTestFinished(() => laidOut.mockRestore());
    savedJigWithArtwork();
    render();
    press('a', { ctrlKey: true });
    const field = container.querySelector<HTMLInputElement>('[aria-label="X (mm)"]');
    if (field === null) throw new Error('Missing selection field');
    act(() => field.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '42');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    // The re-created field must not hand focus, and the Enter, to the first
    // button in the editor (the tutorial).
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Registration Jig editor');
    expect(container.querySelector<HTMLInputElement>('[aria-label="X (mm)"]')?.value).toBe('42');
    expect(container.textContent).toContain('Unsaved changes');
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
  it('opens on a clean canvas without main-canvas artwork or its selection', () => {
    square('main', 150, 180);
    useStore.getState().selectObject('main');
    render();
    expect(canvasText()).not.toContain('main');
    expect(press('a', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(container.textContent).not.toMatch(/\d+ selected/);
  });
  it('saves jig edits and leaves main-canvas artwork exactly as it was', () => {
    savedJigWithArtwork();
    square('main', 5, 5);
    const main = useStore.getState().project.scene.objects.find((item) => item.id === 'main');
    render();
    press('a', { ctrlKey: true });
    press('ArrowRight');
    press('Delete');
    click('Save to canvas');
    const { objects } = useStore.getState().project.scene;
    expect(objects.find((item) => item.id === 'main')).toBe(main);
    expect(objects.some((item) => item.id === 'art')).toBe(false);
  });
  it('has no power, speed or other burn settings', () => {
    savedJigWithArtwork();
    render();
    press('a', { ctrlKey: true });
    for (const tab of ['Artwork', 'Jig layout']) {
      click(tab);
      expect(container.textContent).toContain('Burns use each operation’s current settings');
    }
    const text = container.textContent ?? '';
    for (const label of ['Power', 'Speed', 'Passes', 'Line / Fill', 'laser settings', 'Air assist'])
      expect(text).not.toContain(label);
  });
});
