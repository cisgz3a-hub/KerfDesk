import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  type Project,
  type SelectionAnchor,
  type ShapeObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { computeMouseDownDrag, type DragState } from './drag-state';
import { panOffsetForDrag } from './pan-drag';
import { applyTransformDrag } from './apply-transform-drag';
import { beginDrawDrag, commitDraftShape } from './draw-tool';
import type { MeasureDraft } from './measure-tool';
import { handlePenMouseDown } from './pen-tool';
import { beginPathNodeDrag } from './path-node-drag';
import { dispatchPositionLaser } from './position-laser-click';
import { hitCncTabAnchor } from './cnc-tab-editor';
import { selectObjectsInMarquee } from './selection-marquee';
import { useEscCancelsDrag } from './use-esc-cancels-drag';
import type { SnapGuide, SnapSettings } from './snapping';
import { canvasMouseToScene, pxToMmForCanvas } from './view-transform';
import { openContextBarForRightClick } from './workspace-context-menu';
import { useWorkspaceDragDeps } from './workspace-drag-deps';
import { updateSelectionMoveCursor } from './selection-move-cursor';
import {
  handleNonTransformDragUpdate,
  updateDrawDraft,
  updateMeasureDraft,
} from './workspace-drag-updates';
import { handleArtworkNumberingPointerDown } from './artwork-numbering-click';
import { capturePointer, releasePointer } from './pointer-capture';

type CanvasMouseEvent = ReactMouseEvent<HTMLCanvasElement>;
// The canvas binds POINTER events so an in-progress drag can be captured to the
// element (setPointerCapture) and keep receiving move/up even when the pointer
// leaves the canvas — the previous mouse-event wiring committed the drag the
// moment the pointer crossed the edge (audit C1). A PointerEvent carries every
// MouseEvent field, so the internal drag helpers keep taking CanvasMouseEvent.
type CanvasPointerEvent = ReactPointerEvent<HTMLCanvasElement>;
type CanvasRef = RefObject<HTMLCanvasElement | null>;
type WorkspaceViewState = {
  readonly zoomFactor: number;
  readonly panX: number;
  readonly panY: number;
};

type DragHandlers = {
  readonly onPointerDown: (e: CanvasPointerEvent) => void;
  readonly onPointerMove: (e: CanvasPointerEvent) => void;
  readonly onPointerUp: (e: CanvasPointerEvent) => void;
};

type DragMoveResult = {
  readonly handlers: DragHandlers;
  readonly dragKind: 'move' | 'scale' | 'rotate' | null;
};

export function useDragMove(
  ref: CanvasRef,
  project: Project,
  previewMode: boolean,
  viewState: WorkspaceViewState,
): DragMoveResult {
  const deps = useWorkspaceDragDeps();
  const [drag, setDrag] = useState<DragState | null>(null);

  const handlePointerDown = (e: CanvasPointerEvent): void => {
    useUiStore.getState().closeWorkspaceContextBar();
    deps.setSnapGuides([]);
    if (previewMode) return;
    if (handleArtworkNumberingPointerDown({ event: e, canvas: ref.current, project, viewState }))
      return;
    const next = beginWorkspaceDrag({
      e,
      ref,
      project,
      viewState,
      toolMode: deps.toolMode,
      selectedObjectId: deps.selectedObjectId,
      additionalSelectedIds: deps.additionalSelectedIds,
      selectObject: deps.selectObject,
      selectPathNode: deps.selectPathNode,
      toggleSelectObject: deps.toggleSelectObject,
      drawShape: deps.drawShape,
      selectionAnchor: deps.selectionAnchor,
    });
    if (next === null) return;
    // Capture so move/up keep coming while the drag runs off-canvas (audit C1).
    capturePointer(ref.current, e.pointerId);
    if (next.kind === 'marquee') {
      deps.setSelectionMarquee({ start: next.startScenePoint, end: next.startScenePoint });
    } else if (next.kind === 'measure') {
      deps.setMeasureDraft({ start: next.startScenePoint, end: next.startScenePoint });
    } else if (next.kind !== 'pan') {
      deps.beginInteraction();
    }
    setDrag(next);
  };

  const handlePointerMove = (e: CanvasPointerEvent): void => {
    updateSelectionMoveCursor({
      e,
      canvas: ref.current,
      drag,
      project,
      previewMode,
      viewState,
      toolMode: deps.toolMode,
      selectedObjectId: deps.selectedObjectId,
      additionalSelectedIds: deps.additionalSelectedIds,
    });
    runWorkspaceDragMove({ e, ref, drag, project, viewState, deps });
  };

  const handlePointerUp = (e: CanvasPointerEvent): void => {
    releasePointer(ref.current, e.pointerId);
    deps.setCursorMm(null);
    deps.setSnapGuides([]);
    if (drag === null) return;
    finishWorkspaceDrag({
      drag,
      e,
      ref,
      project,
      viewState,
      drawShape: deps.drawShape,
      setDraftShape: deps.setDraftShape,
      setMeasureDraft: deps.setMeasureDraft,
      selectObject: deps.selectObject,
      selectObjects: deps.selectObjects,
      setSelectionMarquee: deps.setSelectionMarquee,
      endInteraction: deps.endInteraction,
    });
    setDrag(null);
  };
  useEscCancelsDrag(drag, deps, setDrag);
  const handlers = dragHandlers(handlePointerDown, handlePointerMove, handlePointerUp);
  return { handlers, dragKind: visibleDragKind(drag) };
}

function dragHandlers(
  onPointerDown: DragHandlers['onPointerDown'],
  onPointerMove: DragHandlers['onPointerMove'],
  onPointerUp: DragHandlers['onPointerUp'],
): DragHandlers {
  return { onPointerDown, onPointerMove, onPointerUp };
}

// Pointer-move fan-out, lifted out of useDragMove so that hook stays under the
// function-line cap. Threads the store deps into the pure drag-update layer.
function runWorkspaceDragMove(args: {
  readonly e: CanvasPointerEvent;
  readonly ref: CanvasRef;
  readonly drag: DragState | null;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly deps: ReturnType<typeof useWorkspaceDragDeps>;
}): void {
  const { deps } = args;
  updateWorkspaceDrag({
    e: args.e,
    ref: args.ref,
    drag: args.drag,
    project: args.project,
    viewState: args.viewState,
    toolMode: deps.toolMode,
    setCursorMm: deps.setCursorMm,
    setDraftShape: deps.setDraftShape,
    setMeasureDraft: deps.setMeasureDraft,
    setSelectionMarquee: deps.setSelectionMarquee,
    setSelectedPathNodePositionDuringInteraction: deps.setSelectedPathNodePositionDuringInteraction,
    setSelectedCncTabAnchorDuringInteraction: deps.setSelectedCncTabAnchorDuringInteraction,
    selectionAnchor: deps.selectionAnchor,
    snapSettings: deps.snapSettings,
    setObjectTransform: deps.setObjectTransform,
    setSnapGuides: deps.setSnapGuides,
  });
}

function beginWorkspaceDrag(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly toolMode: ReturnType<typeof useUiStore.getState>['toolMode'];
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly selectObject: (id: string | null) => void;
  readonly selectPathNode: ReturnType<typeof useStore.getState>['selectPathNode'];
  readonly toggleSelectObject: (id: string) => void;
  readonly drawShape: (shape: ShapeObject) => void;
  readonly selectionAnchor: SelectionAnchor;
}): DragState | null {
  if (args.e.button === 0 && !useUiStore.getState().spaceDown) {
    const tool = beginToolDrag(args);
    if (tool.kind === 'handled') return tool.drag;
  }
  return computeMouseDownDrag({
    e: args.e,
    ref: args.ref,
    project: args.project,
    selectedObjectId: args.selectedObjectId,
    additionalSelectedIds: args.additionalSelectedIds,
    viewState: args.viewState,
    onShiftClick: args.toggleSelectObject,
    onPlainClick: args.selectObject,
    selectionAnchor: args.selectionAnchor,
  });
}

// A primary click routed by the active tool. 'fallthrough' = the select tool
// (or anything unhandled) — the normal selection/transform mouse-down runs.
function beginToolDrag(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly toolMode: ReturnType<typeof useUiStore.getState>['toolMode'];
  readonly selectedObjectId: string | null;
  readonly selectPathNode: ReturnType<typeof useStore.getState>['selectPathNode'];
  readonly drawShape: (shape: ShapeObject) => void;
}):
  | { readonly kind: 'handled'; readonly drag: DragState | null }
  | { readonly kind: 'fallthrough' } {
  if (args.toolMode.kind === 'node') {
    return { kind: 'handled', drag: beginPathNodeDragForNodeTool(args) };
  }
  if (args.toolMode.kind === 'draw') {
    if (args.toolMode.shape === 'polyline') {
      handlePenMouseDown(args);
      return { kind: 'handled', drag: null };
    }
    return { kind: 'handled', drag: beginDrawDrag({ ...args, shape: args.toolMode.shape }) };
  }
  if (args.toolMode.kind === 'measure') {
    const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
    return {
      kind: 'handled',
      drag: point === null ? null : { kind: 'measure', startScenePoint: point },
    };
  }
  if (args.toolMode.kind === 'cnc-tabs') {
    const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
    const object = args.project.scene.objects.find((item) => item.id === args.selectedObjectId);
    if (point === null || object === undefined) return { kind: 'handled', drag: null };
    return {
      kind: 'handled',
      drag: hitCncTabAnchor(
        object,
        args.toolMode.layerColor,
        point,
        pxToMmForCanvas(args.ref.current, args.project, args.viewState),
      ),
    };
  }
  if (args.toolMode.kind === 'position-laser') {
    const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
    if (point !== null) dispatchPositionLaser(point, args.project.device);
    return { kind: 'handled', drag: null }; // a positioning click never starts a drag
  }
  return { kind: 'fallthrough' };
}

function beginPathNodeDragForNodeTool(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly selectPathNode: ReturnType<typeof useStore.getState>['selectPathNode'];
}): DragState | null {
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  if (point === null) {
    args.selectPathNode(null);
    return null;
  }
  const pxToMm = pxToMmForCanvas(args.ref.current, args.project, args.viewState);
  return beginPathNodeDrag({
    project: args.project,
    scenePoint: point,
    pxToMm,
    additive: args.e.shiftKey,
    selectedPathNodes: useStore.getState().selectedPathNodes,
    selectPathNode: args.selectPathNode,
  });
}

function updateWorkspaceDrag(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly drag: DragState | null;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly toolMode: ReturnType<typeof useUiStore.getState>['toolMode'];
  readonly setCursorMm: (point: Vec2 | null) => void;
  readonly setDraftShape: (shape: ShapeObject | null) => void;
  readonly setMeasureDraft: (draft: MeasureDraft | null) => void;
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
  readonly setSelectedCncTabAnchorDuringInteraction: (
    anchorIndex: number,
    layerColor: string,
    scenePoint: Vec2,
  ) => void;
  readonly selectionAnchor: SelectionAnchor;
  readonly snapSettings: SnapSettings;
  readonly setObjectTransform: (id: string, transform: Transform) => void;
  readonly setSnapGuides: (next: ReadonlyArray<SnapGuide>) => void;
}): void {
  const canvas = args.ref.current;
  if (args.drag?.kind === 'pan' && canvas !== null) {
    args.setSnapGuides([]);
    const next = panOffsetForDrag({ ...args, drag: args.drag, canvas });
    useUiStore.getState().setPan(next.panX, next.panY);
    return;
  }
  const point = canvasMouseToScene(args.e, canvas, args.project, args.viewState);
  args.setCursorMm(point);
  if (handleNonTransformDragUpdate({ ...args, point })) return;
  applyTransformDrag({ ...args, point });
}

function finishWorkspaceDrag(args: {
  readonly drag: DragState;
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly drawShape: (shape: ShapeObject) => void;
  readonly setDraftShape: (shape: ShapeObject | null) => void;
  readonly setMeasureDraft: (draft: MeasureDraft | null) => void;
  readonly selectObject: (id: string | null) => void;
  readonly selectObjects: (
    ids: ReadonlyArray<string>,
    options?: { readonly additive?: boolean },
  ) => void;
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
  readonly endInteraction: () => void;
}): void {
  if (args.drag.kind === 'draw') {
    commitDrawDraft({ ...args, drag: args.drag });
    return;
  }
  if (args.drag.kind === 'measure') {
    const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
    updateMeasureDraft({
      drag: args.drag,
      point,
      constrained: args.e.shiftKey,
      setMeasureDraft: args.setMeasureDraft,
    });
    return;
  }
  const drag = args.drag;
  if (drag.kind === 'pan') {
    openContextBarForRightClick({
      drag,
      e: args.e,
      ref: args.ref,
      project: args.project,
      viewState: args.viewState,
      selectObject: args.selectObject,
    });
    return;
  }
  if (args.drag.kind === 'marquee') {
    commitSelectionMarquee({ ...args, drag: args.drag });
    return;
  }
  args.endInteraction();
}

function commitSelectionMarquee(args: {
  readonly drag: Extract<DragState, { kind: 'marquee' }>;
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly selectObjects: (
    ids: ReadonlyArray<string>,
    options?: { readonly additive?: boolean },
  ) => void;
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
}): void {
  const end = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  args.setSelectionMarquee(null);
  if (end === null) return;
  const ids = selectObjectsInMarquee(args.project.scene, args.drag.startScenePoint, end);
  args.selectObjects(ids, { additive: args.drag.additive });
}

function commitDrawDraft(args: {
  readonly drag: Extract<DragState, { kind: 'draw' }>;
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly setDraftShape: (shape: ShapeObject | null) => void;
  readonly drawShape: (shape: ShapeObject) => void;
}): void {
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  updateDrawDraft({ ...args, point });
  commitDraftShape(args.drawShape);
}

function visibleDragKind(drag: DragState | null): DragMoveResult['dragKind'] {
  if (drag === null) return null;
  // A multi-selection resize reads out like a scale.
  if (drag.kind === 'selection-scale') return 'scale';
  if (drag.kind === 'move' || drag.kind === 'scale' || drag.kind === 'rotate') return drag.kind;
  return null;
}
