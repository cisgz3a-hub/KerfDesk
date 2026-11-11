// Annoyance audit A4-P2-5 and A4-P2-3, through the real canvas pointer pipeline:
//   * a plain click on the Preview canvas does nothing and says why, once;
//   * a right-click on locked artwork offers to unlock that one object.

import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { PREVIEW_EDIT_HINT } from '../state/preview-edit-hint';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { useDragMove } from './use-workspace-drag';
import { computeView } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CANVAS_SIZE_PX = 200;
const VIEW_STATE = { zoomFactor: 1, panX: 0, panY: 0 };
const POINTER_ID = 7;
const mountedRoots: Root[] = [];

beforeEach(() => {
  resetStore();
  useUiStore.setState({
    spaceDown: false,
    toolMode: { kind: 'select' },
    workspaceContextBar: null,
    zoomFactor: 1,
    panX: 0,
    panY: 0,
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
  if (useStore.getState().previewMode) useStore.getState().togglePreview();
  useToastStore.setState({ toasts: [] });
});

function messages(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

describe('a click on the Preview canvas (A4-P2-5)', () => {
  it('does nothing and says why on the first click only', async () => {
    const project = projectWithRectangle();
    useStore.getState().setProject(project);
    useStore.getState().selectObject(null);
    useStore.getState().togglePreview();
    const loaded = useStore.getState().project;
    const { canvas } = await renderHarness({ previewMode: true });
    const onEdge = clientForScenePoint(project, { x: 20, y: 50 });

    await click(canvas, onEdge, 0);
    // The click neither selects the artwork under it nor changes the design.
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().project).toBe(loaded);
    expect(messages()).toEqual([PREVIEW_EDIT_HINT]);

    useToastStore.setState({ toasts: [] });
    await click(canvas, onEdge, 0);
    expect(messages()).toEqual([]);
  });

  it.each([
    ['the wheel button', 1],
    ['the right button', 2],
  ])('stays quiet for a pan with %s', async (_label, button) => {
    const project = projectWithRectangle();
    useStore.getState().setProject(project);
    useStore.getState().togglePreview();
    const { canvas } = await renderHarness({ previewMode: true });

    await click(canvas, clientForScenePoint(project, { x: 20, y: 50 }), button);
    expect(messages()).toEqual([]);
  });

  it('stays quiet for a click in the design view', async () => {
    const project = projectWithRectangle();
    useStore.getState().setProject(project);
    const { canvas } = await renderHarness();

    await click(canvas, clientForScenePoint(project, { x: 300, y: 300 }), 0);
    expect(messages()).toEqual([]);
  });
});

describe('a right-click on locked artwork (A4-P2-3)', () => {
  it('names the locked object for the menu, and nothing for unlocked artwork or empty space', async () => {
    const project = projectWithRectangle({ locked: true });
    useStore.getState().setProject(project);
    const { canvas } = await renderHarness();

    await click(canvas, clientForScenePoint(project, { x: 20, y: 50 }), 2);
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({
      context: 'workspace-empty',
      lockedObjectId: 'rect',
    });

    await click(canvas, clientForScenePoint(project, { x: 300, y: 300 }), 2);
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({ context: 'workspace-empty' });
    expect(useUiStore.getState().workspaceContextBar?.lockedObjectId).toBeUndefined();
  });

  it('selects unlocked artwork as before, with no unlock offer', async () => {
    const project = projectWithRectangle();
    useStore.getState().setProject(project);
    const { canvas } = await renderHarness();

    await click(canvas, clientForScenePoint(project, { x: 20, y: 50 }), 2);
    expect(useStore.getState().selectedObjectId).toBe('rect');
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({
      context: 'workspace-selection',
    });
    expect(useUiStore.getState().workspaceContextBar?.lockedObjectId).toBeUndefined();
  });
});

function DragHarness(props: { readonly previewMode?: boolean }): JSX.Element {
  const project = useStore((state) => state.project);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    ref.current = node;
    if (node !== null) installCanvasRect(node);
  }, []);
  const { handlers } = useDragMove(ref, project, props.previewMode ?? false, VIEW_STATE);
  return (
    <canvas
      ref={setCanvasRef}
      width={CANVAS_SIZE_PX}
      height={CANVAS_SIZE_PX}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onLostPointerCapture={handlers.onLostPointerCapture}
      onPointerLeave={handlers.onPointerLeave}
      aria-label="preview and lock test canvas"
    />
  );
}

async function renderHarness(
  props: { readonly previewMode?: boolean } = {},
): Promise<{ readonly canvas: HTMLCanvasElement }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  await act(async () => {
    root.render(<DragHarness {...props} />);
  });
  const canvas = host.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('harness canvas missing');
  return { canvas };
}

async function click(
  canvas: HTMLCanvasElement,
  at: { readonly clientX: number; readonly clientY: number },
  button: number,
): Promise<void> {
  for (const type of ['pointerdown', 'pointerup'] as const) {
    // jsdom has no PointerEvent constructor: a MouseEvent of the pointer type
    // reaches React's onPointerX, with a pointerId attached.
    const event = new MouseEvent(type, { bubbles: true, button, ...at });
    Object.defineProperty(event, 'pointerId', { value: POINTER_ID });
    await act(async () => {
      canvas.dispatchEvent(event);
    });
  }
}

function installCanvasRect(canvas: HTMLCanvasElement): void {
  canvas.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: CANVAS_SIZE_PX,
      bottom: CANVAS_SIZE_PX,
      width: CANVAS_SIZE_PX,
      height: CANVAS_SIZE_PX,
      toJSON: () => ({}),
    }) as DOMRect;
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  canvas.hasPointerCapture = () => false;
}

function clientForScenePoint(
  project: Project,
  point: Vec2,
): { readonly clientX: number; readonly clientY: number } {
  const view = computeView(
    CANVAS_SIZE_PX,
    CANVAS_SIZE_PX,
    project.device.bedWidth,
    project.device.bedHeight,
    VIEW_STATE,
  );
  return {
    clientX: view.offsetX + point.x * view.scale,
    clientY: view.offsetY + point.y * view.scale,
  };
}

function projectWithRectangle(options: { readonly locked?: boolean } = {}): Project {
  const rect = createRectangle({
    id: 'rect',
    color: '#000000',
    spec: { widthMm: 60, heightMm: 60, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
  });
  return {
    ...createProject(),
    scene: {
      objects: [options.locked === true ? { ...rect, locked: true } : rect],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
}
