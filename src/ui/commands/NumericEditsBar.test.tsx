import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { NumericEditsBar } from './NumericEditsBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useUiStore.setState({ selectionAnchor: 'nw' });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('NumericEditsBar', () => {
  it('keeps all transform fields available with the anchor grid collapsed', async () => {
    const container = await render(<NumericEditsBar />);
    const toolbar = container.querySelector('section[aria-label="Numeric Edits Toolbar"]');
    expect(toolbar).toBeInstanceOf(HTMLElement);
    // Live machine actions are an App-shell sibling, not mixed into selection edits.
    const editsGroup = toolbar?.querySelector(':scope > div');
    expect(editsGroup).toBeInstanceOf(HTMLElement);
    expect(editsGroup?.querySelectorAll('input')).toHaveLength(5);
    expect(toolbar?.querySelector('button[aria-label="Choose transform anchor"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"][aria-label="Transform anchor"]')).toBeNull();
    expect(toolbar?.querySelector('[aria-label="Live machine controls"]')).toBeNull();
  });

  // The box mirrors the scene. A commit the store refuses or normalizes leaves
  // the mirrored value unchanged, so re-seeding only on a value CHANGE left the
  // field advertising a size the selection never took.
  it('snaps a refused edit back to the value the scene actually holds', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    const width = input(container, 'Selection width');
    expect(width.value).toBe('20');

    await act(async () => {
      setInputValue(width, '0');
      Simulate.change(width);
    });
    await act(async () => Simulate.blur(width));

    // A zero width is refused by the store; the field must not keep claiming 0.
    expect(useStore.getState().project.scene.objects[0]?.bounds).toMatchObject({
      minX: 0,
      maxX: 20,
    });
    expect(input(container, 'Selection width').value).toBe('20');
  });

  it('renders disabled numeric fields when nothing is selected', async () => {
    const container = await render(<NumericEditsBar />);

    expect(input(container, 'Selection X position').disabled).toBe(true);
    expect(input(container, 'Selection width').disabled).toBe(true);
    expect(button(container, 'Choose transform anchor').disabled).toBe(true);
  });

  it('explains the 9-point anchor buttons on hover', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    await act(async () => button(container, 'Choose transform anchor').click());
    const anchor = button(document.body, 'Transform anchor: top right');

    expect(anchor.title).toContain('top-right point');
    expect(anchor.textContent).not.toBe('.');
  });

  it('stores the selected anchor for numeric fields and canvas transforms', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    await act(async () => button(container, 'Choose transform anchor').click());
    const anchor = button(document.body, 'Transform anchor: middle right');

    await act(async () => {
      anchor.click();
    });

    expect(useUiStore.getState().selectionAnchor).toBe('e');
    expect(button(container, 'Choose transform anchor').getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(document.activeElement).toBe(button(container, 'Choose transform anchor'));
    expect(input(container, 'Selection X position').value).toBe('20');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('opens the selected anchor with the keyboard and navigates all nine positions', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    const trigger = button(container, 'Choose transform anchor');
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(9);
    expect(document.activeElement).toBe(button(document.body, 'Transform anchor: top left'));
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(button(document.body, 'Transform anchor: middle left'));
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(button(document.body, 'Transform anchor: bottom right'));
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(useUiStore.getState().selectionAnchor).toBe('se');
    expect(document.activeElement).toBe(trigger);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('dismisses the anchor picker with Escape without changing the anchor', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    const trigger = button(container, 'Choose transform anchor');
    await act(async () => trigger.click());
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(useUiStore.getState().selectionAnchor).toBe('nw');
  });

  it('commits an exact X position edit through the selection transform path', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    const x = input(container, 'Selection X position');

    await act(async () => {
      setInputValue(x, '75');
      x.dispatchEvent(new InputEvent('input', { bubbles: true }));
      x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const object = useStore.getState().project.scene.objects.find((item) => item.id === 'shape-1');
    expect(object?.transform.x).toBe(75);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('marks a blank draft invalid without coercing it to zero or creating undo history', async () => {
    installProject(25);
    const container = await render(<NumericEditsBar />);
    const x = input(container, 'Selection X position');

    await act(async () => {
      setInputValue(x, '');
      x.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(x.getAttribute('aria-invalid')).toBe('true');
    await act(async () => {
      x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(useStore.getState().project.scene.objects[0]?.transform.x).toBe(25);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(input(container, 'Selection X position').value).toBe('25');
  });

  it('treats step as an editing increment rather than refusing finite values', async () => {
    installProject(25);
    const container = await render(<NumericEditsBar />);
    const x = input(container, 'Selection X position');

    await act(async () => {
      setInputValue(x, '25.05');
      x.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(x.getAttribute('aria-invalid')).toBe('false');
    await act(async () => Simulate.blur(x));

    expect(useStore.getState().project.scene.objects[0]?.transform.x).toBe(25.05);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  // Bug (2026-07-16): the aspect lock defaulted ON, so setting width silently
  // rescaled height (and vice versa) — the operator could never dial in an
  // independent W and H. LightBurn's W/H fields are independent unless the
  // operator links them, so the lock must start OFF.
  it('starts with the aspect-ratio lock off', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    expect(button(container, 'Lock aspect ratio').getAttribute('aria-pressed')).toBe('false');
  });

  it('edits width without rescaling height by default', async () => {
    installProject(); // rect 20 x 10, identity transform
    const container = await render(<NumericEditsBar />);
    const width = input(container, 'Selection width');

    await act(async () => {
      setInputValue(width, '40');
      width.dispatchEvent(new InputEvent('input', { bubbles: true }));
      width.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const object = useStore.getState().project.scene.objects.find((item) => item.id === 'shape-1');
    // Width doubled (20 -> 40) but height is untouched — no proportional snap.
    expect(object?.transform.scaleX).toBe(2);
    expect(object?.transform.scaleY).toBe(1);
  });
});

async function render(node: JSX.Element): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
  return host;
}

function input(container: HTMLDivElement, label: string): HTMLInputElement {
  const found = container.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} missing`);
  return found;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  return found;
}

function setInputValue(inputElement: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native input value setter missing');
  setter.call(inputElement, value);
}

function installProject(x = 0): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        layers: [],
        objects: [
          {
            kind: 'shape',
            id: 'shape-1',
            spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
            color: '#000000',
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
            transform: { ...IDENTITY_TRANSFORM, x },
            paths: [],
          },
        ],
      },
    },
    selectedObjectId: 'shape-1',
    additionalSelectedIds: new Set(),
    undoStack: [],
  });
}
