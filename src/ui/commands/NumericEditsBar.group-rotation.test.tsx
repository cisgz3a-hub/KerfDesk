// Rolling audit v7 L4-P2-1 (ADR-678): the Rotation box turns a group or any
// multi-object selection as one piece about the selection centre, as LightBurn's
// Rotate field and the remote rotate do. It used to be disabled and empty.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { prepareTransforms } from '../remote-control/transforms';
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

describe('NumericEditsBar rotation of several objects', () => {
  it('turns a clicked group by a typed angle, as the remote rotate does', async () => {
    installRects({ a: 0, b: 0 });
    useStore.getState().selectObjects(['a', 'b']);
    useStore.getState().groupSelection();
    // Clicking one member selects the whole group.
    useStore.getState().selectObject('a');
    const before = objects();
    const undoDepth = useStore.getState().undoStack.length;
    const remote = prepareTransforms(before, { type: 'rotate', angleDeg: 37.5 });
    const container = await render(<NumericEditsBar />);
    const rotation = input(container, 'Selection rotation');
    expect(rotation.disabled).toBe(false);
    expect(rotation.value).toBe('0');
    expect(rotation.title).toContain('Turns the whole selection about its centre.');

    await typeAndPress(rotation, '30+7.5', 'Enter');

    const after = objects();
    expect(after.map((object) => object.transform.rotationDeg)).toEqual([37.5, 37.5]);
    for (const { id, transform } of remote) {
      const turned = after.find((object) => object.id === id)?.transform;
      expect(turned?.x).toBeCloseTo(transform.x, 9);
      expect(turned?.y).toBeCloseTo(transform.y, 9);
    }
    expect(input(container, 'Selection rotation').value).toBe('37.5');
    expect(useStore.getState().undoStack).toHaveLength(undoDepth + 1);
    expect(useToastStore.getState().toasts).toEqual([]);

    // The shown angle is replaced: typing the old one puts the group back.
    await typeAndPress(input(container, 'Selection rotation'), '0', 'Enter');
    objects().forEach((object, index) => {
      expect(object.transform.x).toBeCloseTo(before[index]!.transform.x, 9);
      expect(object.transform.y).toBeCloseTo(before[index]!.transform.y, 9);
      expect(object.transform.rotationDeg).toBeCloseTo(0, 9);
    });
  });

  it('leaves the box blank but editable for mixed angles, and turns them all by the typed angle', async () => {
    installRects({ a: 0, b: 30 });
    useStore.getState().selectObjects(['a', 'b']);
    const before = objects();
    const container = await render(<NumericEditsBar />);
    const rotation = input(container, 'Selection rotation');
    expect(rotation.disabled).toBe(false);
    expect(rotation.value).toBe('');
    expect(rotation.placeholder).toBe('Mixed');
    expect(rotation.title).toContain('turned to different angles');

    await typeAndPress(rotation, '15', 'Enter');

    const after = objects();
    expect(after.map((object) => object.transform.rotationDeg)).toEqual([15, 45]);
    const remote = prepareTransforms(before, { type: 'rotate', angleDeg: 15 });
    remote.forEach(({ transform }, index) => {
      expect(after[index]!.transform.x).toBeCloseTo(transform.x, 9);
      expect(after[index]!.transform.y).toBeCloseTo(transform.y, 9);
    });
    expect(input(container, 'Selection rotation').value).toBe('');
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

function objects(): ReadonlyArray<SceneObject> {
  return useStore.getState().project.scene.objects;
}

function installRects(rotations: { readonly a: number; readonly b: number }): void {
  const rect = (id: 'a' | 'b', x: number): SceneObject => ({
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y: 40, rotationDeg: rotations[id] },
    paths: [],
  });
  useStore.setState({
    project: {
      ...createProject(),
      scene: { layers: [], objects: [rect('a', 10), rect('b', 60)] },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    undoStack: [],
  });
}

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

async function typeAndPress(
  inputElement: HTMLInputElement,
  value: string,
  key: string,
): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(inputElement, value);
    inputElement.dispatchEvent(new InputEvent('input', { bubbles: true }));
    inputElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}
