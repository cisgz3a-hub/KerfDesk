// Audit 08-P2-2: Width and Height refused every horizontal or vertical line,
// because the line has no extent on its other axis.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, selectionMetrics } from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
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
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('NumericEditsBar on straight lines', () => {
  it('sets the length of a horizontal line, aspect unlocked and locked', async () => {
    installLine({ x: 40, y: 20 });
    const container = await render();
    expect(input(container, 'Selection width').value).toBe('30');
    expect(input(container, 'Selection height').value).toBe('0');

    await typeAndPress(input(container, 'Selection width'), '50', 'Enter');
    expect(lineSize()).toEqual({ width: 50, height: 0 });
    expect(useStore.getState().undoStack).toHaveLength(1);

    await act(async () => button(container, 'Lock aspect ratio').click());
    await typeAndPress(input(container, 'Selection width'), '25', 'Enter');
    expect(lineSize()).toEqual({ width: 25, height: 0 });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('sets the length of a vertical line', async () => {
    installLine({ x: 10, y: 60 });
    const container = await render();

    await typeAndPress(input(container, 'Selection height'), '80', 'Enter');

    expect(lineSize()).toEqual({ width: 0, height: 80 });
  });

  it('refuses only the axis the line has no extent on, and says why', async () => {
    installLine({ x: 40, y: 20 });
    const container = await render();
    const before = useStore.getState().project;

    await typeAndPress(input(container, 'Selection height'), '10', 'Enter');

    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'The selection has no height to scale, like a horizontal line. Change its width instead.',
    ]);
    expect(input(container, 'Selection height').value).toBe('0');
  });
});

// A pen line from (10, 20) to `end`.
function installLine(end: { readonly x: number; readonly y: number }): void {
  const line = createPolyline({
    id: 'line',
    color: '#000000',
    spec: { points: [{ x: 10, y: 20 }, end], closed: false },
  });
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [line],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'line',
    additionalSelectedIds: new Set(),
    undoStack: [],
  });
}

function lineSize(): { readonly width: number; readonly height: number } {
  const metrics = selectionMetrics(useStore.getState().project.scene.objects);
  if (metrics === null) throw new Error('line missing');
  return { width: round(metrics.width), height: round(metrics.height) };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

async function render(): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<NumericEditsBar />);
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

async function typeAndPress(inputElement: HTMLInputElement, value: string, key: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(inputElement, value);
    inputElement.dispatchEvent(new InputEvent('input', { bubbles: true }));
    inputElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}
