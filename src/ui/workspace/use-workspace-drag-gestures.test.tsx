// Audit 08 (rolling v2) canvas gestures, through the real pointer hook and the
// real window shortcuts: ruler guides (P2-1), Esc during a draw or measure drag
// (P2-4) and the selection handles on collinear straight lines (P2-2).
import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  selectionMetrics,
  type Project,
  type Vec2,
} from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useShortcuts } from '../app/use-shortcuts';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { useGuideLockStore } from './guide-lock-store';
import { useDragMove } from './use-workspace-drag';
import { computeView } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SIZE_PX = 200;
const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };
const POINTER_ID = 7;
// Inside the top ruler strip (24 px), clear of the left one.
const TOP_RULER = { clientX: 100, clientY: 10 } as const;
const ON_CANVAS = { clientX: 100, clientY: 120 } as const;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};

const roots: Root[] = [];

beforeEach(() => {
  resetStore();
  useGuideLockStore.setState({ locked: false });
  useUiStore.setState({
    draftShape: null,
    measureDraft: null,
    selectionMarquee: null,
    snapGuides: [],
    spaceDown: false,
    toolMode: { kind: 'select' },
    workspaceContextBar: null,
    zoomFactor: 1,
    panX: 0,
    panY: 0,
    artworkRunFocus: null,
    artworkNumbering: { kind: 'idle' },
    selectionAnchor: 'nw',
  });
  useStore.setState({ dirty: false });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
});

describe('ruler guides (08-P2-1)', () => {
  it('leaves the project untouched after a ruler click without a drag', async () => {
    const before = useStore.getState().project;
    const canvas = await render();

    await pointer(canvas, 'pointerdown', TOP_RULER);
    await pointer(canvas, 'pointerup', TOP_RULER);

    const state = useStore.getState();
    expect(state.project).toBe(before);
    expect(state.undoStack).toHaveLength(0);
    expect(state.dirty).toBe(false);
    expect(state.pendingUndo).toBeNull();
  });

  it('takes a guide being pulled away again on Esc', async () => {
    const before = useStore.getState().project;
    const canvas = await render();

    await pointer(canvas, 'pointerdown', TOP_RULER);
    await pointer(canvas, 'pointermove', ON_CANVAS);
    expect(useStore.getState().project.guides).toHaveLength(1);
    await escape();
    await pointer(canvas, 'pointerup', ON_CANVAS);

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('makes a pulled guide one undo step that Undo removes and Redo restores', async () => {
    const canvas = await render();

    await pointer(canvas, 'pointerdown', TOP_RULER);
    await pointer(canvas, 'pointermove', ON_CANVAS);
    await pointer(canvas, 'pointerup', ON_CANVAS);
    const pulled = useStore.getState().project.guides;
    expect(pulled).toEqual([expect.objectContaining({ axis: 'y' })]);
    expect(pulled?.[0]?.positionMm).toBeGreaterThan(0);
    expect(useStore.getState().undoStack).toHaveLength(1);

    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.guides).toBeUndefined();
    expect(useStore.getState().undoStack).toHaveLength(0);

    await act(async () => useStore.getState().redo());
    expect(useStore.getState().project.guides).toEqual(pulled);
  });
});

describe('Esc during a draw or measure drag (08-P2-4)', () => {
  it('draws nothing when the button is released after Esc', async () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    const canvas = await render();

    await pointer(canvas, 'pointerdown', { clientX: 60, clientY: 60 });
    await pointer(canvas, 'pointermove', { clientX: 100, clientY: 100 });
    expect(useUiStore.getState().draftShape).not.toBeNull();
    await escape();
    await pointer(canvas, 'pointermove', { clientX: 120, clientY: 120 });
    await pointer(canvas, 'pointerup', { clientX: 120, clientY: 120 });

    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useUiStore.getState().draftShape).toBeNull();
    // Esc still returns to Select (ADR-051).
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
  });

  it('leaves no measurement behind when the button is released after Esc', async () => {
    useUiStore.getState().setToolMode({ kind: 'measure' });
    const canvas = await render();

    await pointer(canvas, 'pointerdown', { clientX: 60, clientY: 60 });
    await pointer(canvas, 'pointermove', { clientX: 100, clientY: 100 });
    await escape();
    await pointer(canvas, 'pointerup', { clientX: 120, clientY: 120 });

    expect(useUiStore.getState().measureDraft).toBeNull();
  });
});

describe('selection handles on collinear straight lines (08-P2-2)', () => {
  it.each([
    ['aspect locked', false],
    ['Shift, aspect free', true],
  ])('resizes their length from the end handle, %s', async (_label, shiftKey) => {
    useStore.getState().setProject(collinearLinesProject());
    useStore.getState().selectObjects(['left', 'right']);
    const canvas = await render();
    const project = useStore.getState().project;

    await pointer(canvas, 'pointerdown', client(project, { x: 80, y: 150 }));
    await pointer(canvas, 'pointermove', client(project, { x: 115, y: 150 }), { shiftKey });
    await pointer(canvas, 'pointerup', client(project, { x: 115, y: 150 }), { shiftKey });

    const metrics = selectionMetrics(useStore.getState().project.scene.objects);
    expect(metrics?.bbox.minX).toBeCloseTo(10, 6);
    expect(metrics?.width).toBeGreaterThan(90);
    expect(metrics?.height).toBe(0);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

function Harness(): JSX.Element {
  useShortcuts();
  const project = useStore((state) => state.project);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const setRef = useCallback((node: HTMLCanvasElement | null) => {
    ref.current = node;
    if (node === null) return;
    node.getBoundingClientRect = () =>
      ({
        ...{ x: 0, y: 0, left: 0, top: 0, right: SIZE_PX, bottom: SIZE_PX },
        ...{ width: SIZE_PX, height: SIZE_PX, toJSON: () => ({}) },
      }) as DOMRect;
    node.setPointerCapture = vi.fn();
    node.releasePointerCapture = vi.fn();
    node.hasPointerCapture = () => false;
  }, []);
  const { handlers } = useDragMove(ref, project, false, VIEW);
  return (
    <canvas
      ref={setRef}
      width={SIZE_PX}
      height={SIZE_PX}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onLostPointerCapture={handlers.onLostPointerCapture}
    />
  );
}

async function render(): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform}>
        <Harness />
      </PlatformProvider>,
    ),
  );
  const canvas = host.querySelector('canvas');
  if (canvas === null) throw new Error('canvas missing');
  return canvas;
}

async function pointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: { readonly clientX: number; readonly clientY: number },
  modifiers: { readonly shiftKey?: boolean } = {},
): Promise<void> {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: 1, ...at, ...modifiers });
  Object.defineProperty(event, 'pointerId', { value: POINTER_ID });
  await act(async () => {
    canvas.dispatchEvent(event);
  });
}

// Esc on the page, as a key press reaches the window from the focused body.
async function escape(): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
}

function client(project: Project, point: Vec2): { clientX: number; clientY: number } {
  const view = computeView(
    SIZE_PX,
    SIZE_PX,
    project.device.bedWidth,
    project.device.bedHeight,
    VIEW,
  );
  return {
    clientX: view.offsetX + point.x * view.scale,
    clientY: view.offsetY + point.y * view.scale,
  };
}

// Two horizontal pen lines on one row: 10..40 mm and 50..80 mm at y 150 mm.
function collinearLinesProject(): Project {
  const line = (id: string, fromX: number, toX: number) =>
    createPolyline({
      id,
      color: '#000000',
      spec: {
        points: [
          { x: fromX, y: 150 },
          { x: toX, y: 150 },
        ],
        closed: false,
      },
    });
  return {
    ...createProject(),
    scene: {
      objects: [line('left', 10, 40), line('right', 50, 80)],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
}
