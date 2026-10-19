import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findRegistrationBoxes, IDENTITY_TRANSFORM, type Project } from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { jigRunPhase } from './jig-run-phase';
import { RegistrationJigEditor } from './RegistrationJigEditor';

vi.mock('./RegistrationJigCanvas', () => ({
  RegistrationJigCanvas: (props: { project: Project; readOnly?: boolean }) => (
    <div aria-label="Registration jig editing canvas" data-read-only={props.readOnly === true}>
      {findRegistrationBoxes(props.project.scene).length} outlines
    </div>
  ),
}));
vi.mock('./JigArtworkImport', () => ({
  JigArtworkImport: () => <div>Import artwork</div>,
  useJigArtworkImport: () => ({ busy: false, importFiles: async () => undefined }),
}));
vi.mock('../../laser/WorkspaceJobActions', () => ({
  WorkspaceJobActions: () => <section aria-label="Job actions">Frame job</section>,
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const close = vi.fn();
beforeEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({ motionOperation: null });
  close.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useLaserStore.setState({ motionOperation: null });
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
  const page = container.querySelector('[aria-label="Registration Jig"]');
  if (page === null) throw new Error('Missing jig page');
  const event = new KeyboardEvent('keydown', { ...init, key, bubbles: true, cancelable: true });
  act(() => {
    page.dispatchEvent(event);
  });
  return event;
}
function visibleStep(): string | undefined {
  return (
    [...container.querySelectorAll<HTMLElement>('.lf-jig-sidebar > section')]
      .find((section) => !section.hidden)
      ?.getAttribute('aria-label') ?? undefined
  );
}
function jobActions(): number {
  return container.querySelectorAll('[aria-label="Job actions"]').length;
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
  useStore.getState().setRegistrationOutput('box');
}
function artX(): number | undefined {
  return useStore.getState().project.scene.objects.find((object) => object.id === 'art')?.transform
    .x;
}
describe('Registration Jig mode', () => {
  it('creates the first outline in the project as one undo step, ready to burn', () => {
    const depth = useUiStore.getState().modalDepth;
    render();
    const { project, undoStack } = useStore.getState();
    expect(findRegistrationBoxes(project.scene)).toHaveLength(1);
    expect(findRegistrationBoxes(project.scene)[0]?.locked).toBe(true);
    expect(jigRunPhase(project.scene)).toBe('outlines');
    expect(undoStack).toHaveLength(1);
    expect(visibleStep()).toBe('Burn outlines');
    // Not a modal: the machine panel, dialogs and shortcuts stay live.
    expect(useUiStore.getState().modalDepth).toBe(depth);
  });
  it('has no Save or Close without saving; Done returns to the main canvas', () => {
    render();
    const project = useStore.getState().project;
    expect(button('Save to canvas')).toBeUndefined();
    expect(button('Close without saving')).toBeUndefined();
    click('Done');
    expect(close).toHaveBeenCalledOnce();
    expect(useStore.getState().project).toBe(project);
  });
  it('opens on the page itself so canvas keys reach it', () => {
    render();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Registration Jig');
  });
  it('shows Frame and Start only in the step whose run is next', () => {
    render();
    expect(jobActions()).toBe(1);
    click('3 Burn artwork');
    expect(visibleStep()).toBe('Burn artwork');
    expect(container.textContent).toContain('Burn the outlines in step 1 first');
    expect(jobActions()).toBe(1);
    click('Outlines are already burned');
    expect(jigRunPhase(useStore.getState().project.scene)).toBe('artwork');
    // Marking the outlines burned keeps the operator on the artwork burn.
    expect(visibleStep()).toBe('Burn artwork');
    expect(jobActions()).toBe(1);
    expect(button('Burn outlines again')).toBeDefined();
  });
  it('moves on to placing the pieces when the outline run selects Artwork only', () => {
    render();
    expect(visibleStep()).toBe('Burn outlines');
    act(() => useStore.getState().setRegistrationOutput('artwork'));
    expect(visibleStep()).toBe('Place pieces and artwork');
  });
  it('opens a jig whose outlines are burned on placing the pieces, with them locked', () => {
    savedJigWithArtwork();
    useStore.getState().setRegistrationOutput('artwork');
    render();
    expect(visibleStep()).toBe('Place pieces and artwork');
    click('1 Burn outlines');
    expect(container.querySelector('.lf-jig-lock')?.textContent).toContain('locked');
    expect(button('Select all outlines')?.disabled).toBe(true);
    click('Unlock outlines');
    expect(container.querySelector('.lf-jig-lock')).toBeNull();
    expect(button('Select all outlines')?.disabled).toBe(false);
  });
  it('puts edits straight into the project, where Undo reverts them', () => {
    savedJigWithArtwork();
    useStore.getState().selectObject('art');
    const before = artX();
    const undo = useStore.getState().undoStack.length;
    render();
    press('ArrowRight');
    expect(artX()).toBe(before! + 1);
    expect(useStore.getState().undoStack).toHaveLength(undo + 1);
    act(() => useStore.getState().undo());
    expect(artX()).toBe(before);
  });
  it('Escape clears the selection and never leaves jig mode', () => {
    savedJigWithArtwork();
    useStore.getState().selectObject('art');
    render();
    press('Escape');
    expect(useStore.getState().selectedObjectId).toBeNull();
    press('Escape');
    expect(close).not.toHaveBeenCalled();
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
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Registration Jig');
    expect(useStore.getState().selectedObjectId).toBe('art');
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
    expect(container.textContent).toContain('2 selected');
  });
  it('ignores keys pressed in a dialog the page opens', () => {
    savedJigWithArtwork();
    useStore.getState().selectObject('art');
    render();
    click('Advanced outline settings');
    const inside = [...document.querySelectorAll('[role="dialog"] button')][0];
    if (!(inside instanceof HTMLButtonElement)) throw new Error('Missing Cut Settings dialog');
    act(() => {
      inside.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
      );
    });
    expect(artX()).toBeDefined();
  });
  it('pauses editing while the machine is moving', () => {
    savedJigWithArtwork();
    useStore.getState().selectObject('art');
    const before = artX();
    render();
    act(() => useLaserStore.setState({ motionOperation: { kind: 'frame' } as never }));
    expect(container.textContent).toContain('Editing is paused while the machine runs.');
    expect(
      container
        .querySelector('[aria-label="Registration jig editing canvas"]')
        ?.getAttribute('data-read-only'),
    ).toBe('true');
    press('ArrowRight');
    expect(artX()).toBe(before);
  });
  it('leaves jig mode when another project is opened', () => {
    render();
    act(() => useStore.getState().newProject());
    expect(close).toHaveBeenCalled();
  });
});
