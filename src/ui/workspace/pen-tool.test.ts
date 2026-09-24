import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  type CurveSubpath,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { CURRENT_POLYLINE_FAIRING_VERSION } from '../../core/shapes';
import { createPenPath, type PenNode } from '../../core/shapes/pen-path';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { CANVAS_PADDING_PX } from './canvas-layout';
import { cancelPenNodeDrag, updatePenNodeDrag } from './pen-node-drag';
import {
  finishPen,
  finishPenByRightClick,
  finishPenNodeDrag,
  handlePenMouseDown,
  updatePenHover,
} from './pen-tool';
import { DEFAULT_SNAP_SETTINGS } from './snapping';

// A 400 mm bed on a canvas this size draws at exactly 1 px per mm, so a
// client pixel offset from the padding is the scene point itself.
const CANVAS_SIZE = 400 + CANVAS_PADDING_PX * 2;
const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };
const ref = {
  current: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_SIZE, height: CANVAS_SIZE }),
  } as HTMLCanvasElement,
};

type Modifiers = {
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly detail?: number;
};

function eventAt(point: Vec2, modifiers: Modifiers = {}): React.MouseEvent<HTMLCanvasElement> {
  return {
    button: 0,
    detail: modifiers.detail ?? 1,
    clientX: CANVAS_PADDING_PX + point.x,
    clientY: CANVAS_PADDING_PX + point.y,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: false,
  } as React.MouseEvent<HTMLCanvasElement>;
}

// One press-and-release, optionally dragged to `dragTo` before release.
function press(
  point: Vec2,
  options: { readonly dragTo?: Vec2; readonly modifiers?: Modifiers } = {},
) {
  const { project, drawShape } = useStore.getState();
  const drag = handlePenMouseDown({
    e: eventAt(point, options.modifiers),
    ref,
    project,
    viewState: VIEW,
    drawShape,
  });
  if (drag !== null && options.dragTo !== undefined) updatePenNodeDrag(drag, options.dragTo, false);
  if (drag !== null) finishPenNodeDrag(drag, project, drawShape);
  return drag;
}

function finishOpen(): boolean {
  const { project, drawShape } = useStore.getState();
  return finishPen({ closed: false, project, drawShape });
}

function draftNodes(): ReadonlyArray<PenNode> {
  return useUiStore.getState().penDraft?.nodes ?? [];
}

function objects(): ReadonlyArray<SceneObject> {
  return useStore.getState().project.scene.objects;
}

function onlyCurve(object: SceneObject | undefined): CurveSubpath | undefined {
  return object !== undefined && 'paths' in object ? object.paths[0]?.curves?.[0] : undefined;
}

function addPenDrawing(id: string, points: ReadonlyArray<Vec2>): void {
  const nodes = points.map((point): PenNode => ({ kind: 'corner', point }));
  const shape = createPenPath({ id, color: '#000000', nodes, closed: false });
  if (shape === null) throw new Error('fixture drawing');
  useStore.getState().drawShape(shape);
  useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
}

beforeEach(() => {
  useStore.getState().newProject();
  useUiStore.getState().resetToolMode();
  useUiStore.getState().setActiveLayerColor(null);
  // Grid pull is covered in pen-snap.test.ts; here it would move the clicks.
  useUiStore.getState().setSnapSettings({ ...DEFAULT_SNAP_SETTINGS, snapToGrid: false });
  useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
});

describe('pen clicks and drags (ADR-380)', () => {
  it('joins clicked corners with exact straight segments at the clicked points', () => {
    const clicks = [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
      { x: 53, y: 57 },
      { x: 93, y: 57 },
      { x: 93, y: 97 },
    ];
    clicks.forEach((point) => press(point));
    const placed = draftNodes().map((node) => node.point);
    expect(draftNodes().every((node) => node.kind === 'corner')).toBe(true);
    placed.forEach((point, index) => {
      expect(point.x).toBeCloseTo(clicks[index]?.x ?? NaN, 9);
      expect(point.y).toBeCloseTo(clicks[index]?.y ?? NaN, 9);
    });

    expect(finishOpen()).toBe(true);

    const [shape] = objects();
    expect(shape?.kind === 'shape' && shape.spec).toEqual({
      kind: 'polyline',
      points: placed,
      closed: false,
    });
    expect(onlyCurve(shape)).toEqual({
      start: placed[0],
      segments: placed.slice(1).map((to) => ({ kind: 'line', to })),
      closed: false,
    });
    expect(shape?.kind === 'shape' && shape.fairingVersion).toBe(CURRENT_POLYLINE_FAIRING_VERSION);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
  });

  it('drags out a smooth node whose symmetric handles shape both cubics', () => {
    press({ x: 13, y: 17 });
    press({ x: 53, y: 17 }, { dragTo: { x: 63, y: 27 } });
    press({ x: 93, y: 17 });

    expect(draftNodes()[1]).toEqual({
      kind: 'smooth',
      point: { x: 53, y: 17 },
      handleOut: { x: 63, y: 27 },
    });
    finishOpen();
    expect(onlyCurve(objects()[0])?.segments).toEqual([
      {
        kind: 'cubic',
        control1: { x: 13, y: 17 },
        control2: { x: 43, y: 7 },
        to: { x: 53, y: 17 },
      },
      {
        kind: 'cubic',
        control1: { x: 63, y: 27 },
        control2: { x: 93, y: 17 },
        to: { x: 93, y: 17 },
      },
    ]);
  });

  it('keeps a slightly unsteady click a corner', () => {
    press({ x: 13, y: 17 });
    press({ x: 53, y: 17 }, { dragTo: { x: 54, y: 18 } });

    expect(draftNodes()[1]).toEqual({ kind: 'corner', point: { x: 53, y: 17 } });
  });

  it('holds a Shift-dragged handle to 45 degree steps', () => {
    press({ x: 13, y: 17 });
    const drag = handlePenMouseDown({
      e: eventAt({ x: 53, y: 17 }),
      ref,
      project: useStore.getState().project,
      viewState: VIEW,
      drawShape: useStore.getState().drawShape,
    });
    if (drag === null) throw new Error('expected a node drag');
    updatePenNodeDrag(drag, { x: 73, y: 19 }, true);

    const node = draftNodes()[1];
    expect(node?.kind === 'smooth' && node.handleOut.y).toBeCloseTo(17);
  });

  it('toggles corner and smooth placement with S', () => {
    press({ x: 13, y: 17 });
    useUiStore.getState().togglePenNodeMode();
    press({ x: 53, y: 57 });
    useUiStore.getState().togglePenNodeMode();
    press({ x: 93, y: 17 });

    expect(draftNodes().map((node) => node.kind)).toEqual(['corner', 'auto', 'corner']);
    finishOpen();
    const segments = onlyCurve(objects()[0])?.segments ?? [];
    expect(segments.map((segment) => segment.kind)).toEqual(['cubic', 'cubic']);
  });

  it('closes the path when the first node is pressed again', () => {
    press({ x: 13, y: 17 });
    press({ x: 53, y: 17 });
    press({ x: 53, y: 57 });
    press({ x: 15, y: 18 });

    const curve = onlyCurve(objects()[0]);
    expect(curve?.closed).toBe(true);
    expect(curve?.segments.at(-1)).toEqual({ kind: 'line', to: { x: 13, y: 17 } });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('ignores the second press of a double-click', () => {
    press({ x: 13, y: 17 });
    press({ x: 53, y: 17 }, { modifiers: { detail: 2 } });

    expect(draftNodes()).toHaveLength(1);
  });

  it('takes a node back out when its press is cancelled', () => {
    press({ x: 13, y: 17 });
    const before = useUiStore.getState().penDraft;
    const drag = handlePenMouseDown({
      e: eventAt({ x: 53, y: 17 }),
      ref,
      project: useStore.getState().project,
      viewState: VIEW,
      drawShape: useStore.getState().drawShape,
    });
    if (drag === null) throw new Error('expected a node drag');
    cancelPenNodeDrag(drag);

    expect(useUiStore.getState().penDraft).toBe(before);
  });
});

describe('pen continue and auto-join (ADR-380)', () => {
  it('continues an open pen drawing from its end node', () => {
    addPenDrawing('host', [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
    ]);
    press({ x: 53.5, y: 17.5 });
    expect(useUiStore.getState().penDraft?.continues?.objectId).toBe('host');
    press({ x: 53, y: 57 });
    finishOpen();

    expect(objects()).toHaveLength(1);
    expect(onlyCurve(objects()[0])).toEqual({
      start: { x: 13, y: 17 },
      segments: [
        { kind: 'line', to: { x: 53, y: 17 } },
        { kind: 'line', to: { x: 53, y: 57 } },
      ],
      closed: false,
    });
    expect(useStore.getState().selectedObjectId).toBe('host');
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('keeps the host direction when continuing from its start node', () => {
    addPenDrawing('host', [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
    ]);
    press({ x: 13, y: 17 });
    press({ x: 13, y: 57 });
    finishOpen();

    expect(onlyCurve(objects()[0])).toEqual({
      start: { x: 13, y: 57 },
      segments: [
        { kind: 'line', to: { x: 13, y: 17 } },
        { kind: 'line', to: { x: 53, y: 17 } },
      ],
      closed: false,
    });
  });

  it('starts a separate path on an open end while Ctrl is held', () => {
    addPenDrawing('host', [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
    ]);
    press({ x: 53, y: 17 }, { modifiers: { ctrlKey: true } });
    expect(useUiStore.getState().penDraft?.continues).toBeUndefined();
    press({ x: 53, y: 57 });
    finishOpen();

    expect(objects()).toHaveLength(2);
    expect(onlyCurve(objects()[0])?.segments).toHaveLength(1);
  });

  it('joins two drawings when the path finishes on the second one', () => {
    addPenDrawing('first', [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
    ]);
    addPenDrawing('second', [
      { x: 93, y: 57 },
      { x: 93, y: 97 },
    ]);
    press({ x: 53, y: 17 });
    press({ x: 93, y: 17 });
    press({ x: 93, y: 57 });

    expect(objects().map((object) => object.id)).toEqual(['first']);
    expect(onlyCurve(objects()[0])).toEqual({
      start: { x: 13, y: 17 },
      segments: [
        { kind: 'line', to: { x: 53, y: 17 } },
        { kind: 'line', to: { x: 93, y: 17 } },
        { kind: 'line', to: { x: 93, y: 57 } },
        { kind: 'line', to: { x: 93, y: 97 } },
      ],
      closed: false,
    });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('only meets the second drawing when Ctrl is held at the finish', () => {
    addPenDrawing('first', [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
    ]);
    addPenDrawing('second', [
      { x: 93, y: 57 },
      { x: 93, y: 97 },
    ]);
    press({ x: 53, y: 17 });
    press({ x: 93, y: 57 }, { modifiers: { ctrlKey: true } });
    finishOpen();

    expect(objects()).toHaveLength(2);
    expect(onlyCurve(objects()[0])?.segments.at(-1)).toEqual({
      kind: 'line',
      to: { x: 93, y: 57 },
    });
  });

  it('closes the continued path on reaching its far end', () => {
    addPenDrawing('host', [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
      { x: 53, y: 57 },
    ]);
    press({ x: 53, y: 57 });
    press({ x: 13, y: 57 });
    press({ x: 13, y: 17 });

    const curve = onlyCurve(objects()[0]);
    expect(objects()).toHaveLength(1);
    expect(curve?.closed).toBe(true);
    expect(curve?.segments).toHaveLength(4);
    expect(curve?.segments.at(-1)?.to).toEqual(curve?.start);
  });

  it('reports what a press would do before it happens', () => {
    addPenDrawing('host', [
      { x: 13, y: 17 },
      { x: 53, y: 17 },
    ]);
    const hover = (point: Vec2, modifiers?: Modifiers) => {
      updatePenHover({
        e: eventAt(point, modifiers),
        ref,
        project: useStore.getState().project,
        viewState: VIEW,
      });
      return useUiStore.getState().penHover;
    };

    expect(hover({ x: 52, y: 18 })).toEqual({
      point: { x: 53, y: 17 },
      snap: 'endpoint',
      intent: 'continue',
    });
    expect(hover({ x: 52, y: 18 }, { ctrlKey: true })?.intent).toBe('place');
    expect(hover({ x: 33, y: 19 })).toEqual({
      point: { x: 33, y: 17 },
      snap: 'midpoint',
      intent: 'place',
    });
  });
});

describe('finishPen', () => {
  it('keeps a single-node draft when asked to finish', () => {
    press({ x: 13, y: 17 });

    expect(finishOpen()).toBe(false);
    expect(useUiStore.getState().penDraft).not.toBeNull();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'draw', shape: 'polyline' });
  });

  it('needs three nodes to close', () => {
    press({ x: 13, y: 17 });
    press({ x: 53, y: 17 });
    const { project, drawShape } = useStore.getState();

    expect(finishPen({ closed: true, project, drawShape })).toBe(false);
  });

  it('draws on the current drawing layer', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setActiveLayerColor('#00ff00');
    useUiStore.getState().setPenDraft({
      nodes: [
        { kind: 'corner', point: { x: 0, y: 0 } },
        { kind: 'corner', point: { x: 10, y: 0 } },
      ],
    });

    expect(finishPen({ closed: false, project: twoLayerProject(), drawShape })).toBe(true);
    expect(drawShape.mock.calls[0]?.[0]?.color).toBe('#00ff00');
  });

  it('finishes on a right click and drops a lone node', () => {
    press({ x: 13, y: 17 });
    const { project, drawShape } = useStore.getState();
    expect(finishPenByRightClick(project, drawShape)).toBe(true);
    expect(useUiStore.getState().penDraft).toBeNull();
    expect(objects()).toHaveLength(0);

    press({ x: 13, y: 17 });
    press({ x: 53, y: 17 });
    expect(finishPenByRightClick(useStore.getState().project, drawShape)).toBe(true);
    expect(objects()).toHaveLength(1);
  });

  it('leaves a right click alone when no path is being drawn', () => {
    const { project, drawShape } = useStore.getState();
    expect(finishPenByRightClick(project, drawShape)).toBe(false);
  });
});

function twoLayerProject(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      objects: [],
      layers: [
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
        createLayer({ id: '#00ff00', color: '#00ff00', mode: 'line' }),
      ],
    },
  };
}
