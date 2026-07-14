import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
  it('scopes horizontal scrolling to the transform fields so the safety cluster stays pinned', async () => {
    const container = await render(<NumericEditsBar />);
    const toolbar = container.querySelector('section[aria-label="Numeric Edits Toolbar"]');
    expect(toolbar).toBeInstanceOf(HTMLElement);
    expect((toolbar as HTMLElement).style.minWidth).toBe('0');
    expect((toolbar as HTMLElement).style.maxWidth).toBe('100%');
    // The scroll lives on the inner edits group, not the whole bar, so the
    // job-safety cluster (ABORT) rendered alongside it can never be scrolled
    // out of reach on a narrow window.
    const editsGroup = toolbar?.querySelector(':scope > div');
    expect(editsGroup).toBeInstanceOf(HTMLElement);
    expect((editsGroup as HTMLElement).style.overflowX).toBe('auto');
    expect((editsGroup as HTMLElement).style.minWidth).toBe('0');
  });

  it('renders disabled numeric fields when nothing is selected', async () => {
    const container = await render(<NumericEditsBar />);

    expect(input(container, 'Selection X position').disabled).toBe(true);
    expect(input(container, 'Selection width').disabled).toBe(true);
  });

  it('explains the 9-point anchor buttons on hover', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    const anchor = button(container, 'Transform anchor: top right');

    expect(anchor.title).toContain('top-right point');
    expect(anchor.textContent).not.toBe('.');
  });

  it('stores the selected anchor for numeric fields and canvas transforms', async () => {
    installProject();
    const container = await render(<NumericEditsBar />);
    const anchor = button(container, 'Transform anchor: middle right');

    await act(async () => {
      anchor.click();
    });

    expect(useUiStore.getState().selectionAnchor).toBe('e');
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

function button(container: HTMLDivElement, label: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${label} missing`);
  return found;
}

function setInputValue(inputElement: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native input value setter missing');
  setter.call(inputElement, value);
}

function installProject(): void {
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
            transform: IDENTITY_TRANSFORM,
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
