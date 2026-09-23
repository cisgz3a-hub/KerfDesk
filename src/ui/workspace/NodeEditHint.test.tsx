import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, type SceneObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { hitPathNode } from './path-node-hit-test';
import { NodeEditHint } from './NodeEditHint';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  resetStore();
  useUiStore.getState().setToolMode({ kind: 'node' });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
});

async function render(objects: readonly SceneObject[]): Promise<void> {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        objects,
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
  }));
  await act(async () => {
    root = createRoot(host);
    root.render(<NodeEditHint />);
  });
}

function rectangle(id = 'rectangle') {
  return createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 40, heightMm: 80, cornerRadiusMm: 5 },
  });
}

describe('NodeEditHint', () => {
  it('requires a deliberate conversion, exposes nodes, and restores the primitive with Undo', async () => {
    const primitive = rectangle();
    await render([primitive]);
    const before = useStore.getState().project;
    expect(host.textContent).toContain('Convert the rectangle to a path to edit its nodes.');
    expect(before.scene.objects[0]).toBe(primitive);
    expect(useStore.getState().undoStack).toHaveLength(0);
    const point = primitive.paths[0]?.polylines[0]?.points[0];
    expect(point).toBeDefined();
    expect(hitPathNode(before.scene, point!, 0.01)).toBeNull();

    await act(async () => host.querySelector('button')?.click());

    const after = useStore.getState();
    expect(after.project.scene.objects[0]?.kind).toBe('imported-svg');
    expect(after.selectedObjectId).toBe(primitive.id);
    expect(after.undoStack).toHaveLength(1);
    expect(hitPathNode(after.project.scene, point!, 0.01)?.objectId).toBe(primitive.id);
    expect(useUiStore.getState().toolMode.kind).toBe('node');
    expect(host.textContent).toBe('');

    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().project.scene.objects[0]).toBe(primitive);
    expect(host.querySelector('button')?.textContent).toBe('Convert to Path');
  });

  it('converts multiple primitives as one undo step', async () => {
    await render([rectangle('a'), rectangle('b')]);
    expect(host.textContent).toContain('selected shapes to paths');
    await act(async () => host.querySelector('button')?.click());
    expect(useStore.getState().project.scene.objects.map((object) => object.kind)).toEqual([
      'imported-svg',
      'imported-svg',
    ]);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('leaves editable paths and mixed selections alone', async () => {
    const path = svgObj('path', ['#000000']);
    await render([path, rectangle()]);
    expect(host.querySelector('button')).toBeNull();
    expect(useStore.getState().project.scene.objects[0]).toBe(path);
    expect(useStore.getState().undoStack).toHaveLength(0);
    await act(async () => useStore.setState({ additionalSelectedIds: new Set() }));
    expect(host.textContent).toBe('');
  });

  it('does not offer conversion for locked primitives or outside node mode', async () => {
    await render([{ ...rectangle(), locked: true }]);
    expect(host.textContent).toBe('');
    await act(async () => {
      useStore.setState((state) => ({
        project: { ...state.project, scene: { ...state.project.scene, objects: [rectangle()] } },
      }));
      useUiStore.getState().setToolMode({ kind: 'select' });
    });
    expect(host.textContent).toBe('');
    await act(async () => {
      useUiStore.getState().setToolMode({ kind: 'node' });
      useStore.setState({ previewMode: true });
    });
    expect(host.textContent).toBe('');
  });
});
