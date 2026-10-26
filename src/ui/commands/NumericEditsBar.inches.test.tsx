import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useDisplayUnitsStore } from '../state/display-units';
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
  useDisplayUnitsStore.setState({ lengthUnit: 'in' });
  installRect(25.4, 12.7);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useDisplayUnitsStore.setState({ lengthUnit: 'mm' });
});

describe('NumericEditsBar in inches (ADR-629)', () => {
  it('shows the selection in inches with an inch label', async () => {
    const container = await render();
    expect(input(container, 'Selection width').value).toBe('1');
    expect(input(container, 'Selection height').value).toBe('0.5');
    expect(container.textContent).toContain('in');
    expect(container.textContent).not.toContain('mm');
  });

  it('commits a typed inch value as millimetres', async () => {
    const container = await render();
    await type(input(container, 'Selection width'), '2');
    const bounds = useStore.getState().project.scene.objects[0];
    expect(bounds?.transform.scaleX).toBeCloseTo(2, 12);
  });

  it('lets a typed unit win over inches', async () => {
    const container = await render();
    await type(input(container, 'Selection X position'), '10mm');
    expect(useStore.getState().project.scene.objects[0]?.transform.x).toBe(10);
  });

  it('commits nothing when a rounded inch box is left unedited', async () => {
    installRect(10, 10);
    useStore.setState({ dirty: false });
    const container = await render();
    const width = input(container, 'Selection width');
    expect(width.value).toBe('0.3937');
    await act(async () => Simulate.blur(width));
    expect(useStore.getState().project.scene.objects[0]?.transform.scaleX).toBe(1);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('commits nothing when Enter is pressed on an unedited rounded inch box', async () => {
    installRect(10, 10);
    useStore.setState({ dirty: false });
    const container = await render();
    const width = input(container, 'Selection width');
    expect(width.value).toBe('0.3937');
    await act(async () => {
      width.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(useStore.getState().project.scene.objects[0]?.transform.scaleX).toBe(1);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('follows a switch back to millimetres without editing anything', async () => {
    const container = await render();
    await act(async () => useDisplayUnitsStore.getState().setLengthUnit('mm'));
    expect(input(container, 'Selection width').value).toBe('25.4');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

async function render(): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<NumericEditsBar />));
  return host;
}

function input(container: HTMLDivElement, label: string): HTMLInputElement {
  const found = container.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return found;
}

async function type(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

function installRect(widthMm: number, heightMm: number): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        layers: [],
        objects: [
          {
            kind: 'shape',
            id: 'shape-1',
            spec: { kind: 'rect', widthMm, heightMm, cornerRadiusMm: 0 },
            color: '#000000',
            bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
            transform: { ...IDENTITY_TRANSFORM },
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
