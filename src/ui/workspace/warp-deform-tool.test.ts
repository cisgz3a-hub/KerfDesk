// The Warp and Deform canvas tools (LBG-T06): starting, dragging handles,
// Shift's parallelogram, the live preview, Apply and Cancel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialWarpDeformHandles } from '../../core/geometry/warp-deform-map';
import { createLayer } from '../../core/scene/layer';
import { createProject } from '../../core/scene/project';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Vec2 } from '../../core/scene/scene-object';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { useWarpDeformSession } from '../state/warp-deform-session';
import { warpDeformDisplayProject } from './use-warp-deform-preview';
import {
  activeWarpDeformSession,
  applyWarpDeformTool,
  cancelWarpDeformTool,
  draggedWarpDeformHandles,
  hitWarpDeformHandle,
  moveWarpHandleDrag,
  resetWarpDeformHandles,
  startWarpDeformTool,
  type WarpHandleDragState,
} from './warp-deform-tool';

const PART: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  transform: { ...IDENTITY_TRANSFORM, x: 10, y: 20 },
  operationIds: ['cut'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
            { x: 0, y: 50 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

function install(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [PART],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: PART.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
  });
}

function handles(): ReadonlyArray<Vec2> {
  return useWarpDeformSession.getState().session?.handles ?? [];
}

function drag(index: number, startPoint: Vec2): WarpHandleDragState {
  return { kind: 'warp-handle', index, startPoint, startHandles: handles() };
}

beforeEach(() => {
  resetStore();
  install();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useUiStore.getState().resetToolMode();
  useWarpDeformSession.getState().setSession(null);
});

describe('Warp and Deform tools', () => {
  it('start with their handles on the box round the selection', () => {
    startWarpDeformTool('warp');
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'warp-deform', grid: 'warp' });
    expect(handles()).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);

    startWarpDeformTool('deform');
    expect(handles()).toHaveLength(16);
    expect(activeWarpDeformSession()?.grid).toBe('deform');
  });

  it('do not start without vector artwork, and say why', () => {
    useStore.setState({ selectedObjectId: null });
    startWarpDeformTool('deform');
    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Select unlocked vector artwork to deform first.',
    );
  });

  it('hit the nearest handle within reach of the pointer', () => {
    const points = initialWarpDeformHandles('warp', { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(hitWarpDeformHandle(points, { x: 10.5, y: 0.4 }, 0.1)).toBe(1);
    expect(hitWarpDeformHandle(points, { x: 5, y: 5 }, 0.1)).toBeNull();
  });

  it('move a handle by the pointer offset, not onto the pointer', () => {
    startWarpDeformTool('warp');
    moveWarpHandleDrag(drag(2, { x: 108, y: 69 }), { x: 118, y: 74 }, false);
    expect(handles()[2]).toEqual({ x: 120, y: 75 });
    expect(handles()[0]).toEqual({ x: 10, y: 20 });
  });

  it('keep the Warp handles a parallelogram while Shift is held', () => {
    startWarpDeformTool('warp');
    const next = draggedWarpDeformHandles(
      'warp',
      drag(2, { x: 110, y: 70 }),
      { x: 130, y: 90 },
      true,
    );
    // Corner 2 moved; its neighbours 1 and 3 stayed; corner 0 followed.
    expect(next).toEqual([
      { x: -10, y: 0 },
      { x: 110, y: 20 },
      { x: 130, y: 90 },
      { x: 10, y: 70 },
    ]);
    const [a, b, c, d] = next as [Vec2, Vec2, Vec2, Vec2];
    expect(a.x + c.x).toBe(b.x + d.x);
    expect(a.y + c.y).toBe(b.y + d.y);
  });

  it('preview the bent artwork without touching the project', () => {
    startWarpDeformTool('deform');
    const session = activeWarpDeformSession();
    if (session === null) throw new Error('no session');
    const project = useStore.getState().project;
    expect(warpDeformDisplayProject(project, session)).toBe(project);

    resetWarpDeformHandles();
    moveWarpHandleDrag(drag(5, { x: 43, y: 37 }), { x: 43, y: 57 }, false);
    const moved = activeWarpDeformSession();
    const preview = warpDeformDisplayProject(project, moved);
    expect(preview).not.toBe(project);
    expect(preview.scene.objects[0]).not.toBe(PART);
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('apply as one undo step and return to the Select tool', () => {
    startWarpDeformTool('warp');
    moveWarpHandleDrag(drag(2, { x: 110, y: 70 }), { x: 120, y: 80 }, false);

    applyWarpDeformTool();

    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(useWarpDeformSession.getState().session).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().selectedObjectId).toBe(PART.id);
  });

  it('cancel with the artwork as it was, still selected', () => {
    startWarpDeformTool('warp');
    moveWarpHandleDrag(drag(2, { x: 110, y: 70 }), { x: 120, y: 80 }, false);
    const project = useStore.getState().project;

    cancelWarpDeformTool();

    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().selectedObjectId).toBe(PART.id);
  });

  it('put every handle back with Reset handles', () => {
    startWarpDeformTool('warp');
    const start = handles();
    moveWarpHandleDrag(drag(0, { x: 10, y: 20 }), { x: 0, y: 0 }, false);
    expect(handles()).not.toEqual(start);
    resetWarpDeformHandles();
    expect(handles()).toEqual(start);
  });

  it('ignore a handle drag once the tool has been left', () => {
    startWarpDeformTool('warp');
    const stale = drag(1, { x: 110, y: 20 });
    cancelWarpDeformTool();
    moveWarpHandleDrag(stale, { x: 150, y: 20 }, false);
    expect(useWarpDeformSession.getState().session).toBeNull();
  });
});
