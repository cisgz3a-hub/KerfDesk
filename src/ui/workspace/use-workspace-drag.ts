import { useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { Project, SelectionAnchor, ShapeObject, Transform, Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import {
  computeMouseDownDrag,
  type DragState,
  nextTransformForDrag,
  panOffsetForDrag,
} from './drag-state';
import {
  beginDrawDrag,
  commitDraftShape,
  draftForDrawDrag,
  drawModifiersFromEvent,
} from './draw-tool';
import { handlePenMouseDown, updatePenCursor } from './pen-tool';
import { selectObjectsInMarquee } from './selection-marquee';
import { canvasMouseToScene } from './view-transform';

type CanvasMouseEvent = ReactMouseEvent<HTMLCanvasElement>;
type CanvasRef = RefObject<HTMLCanvasElement | null>;
type WorkspaceViewState = {
  readonly zoomFactor: number;
  readonly panX: number;
  readonly panY: number;
};

type DragHandlers = {
  readonly onMouseDown: (e: CanvasMouseEvent) => void;
  readonly onMouseMove: (e: CanvasMouseEvent) => void;
  readonly onMouseUp: (e: CanvasMouseEvent) => void;
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
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectObject = useStore((s) => s.selectObject);
  const selectObjects = useStore((s) => s.selectObjects);
  const toggleSelectObject = useStore((s) => s.toggleSelectObject);
  const setCursorMm = useStore((s) => s.setCursorMm);
  const beginInteraction = useStore((s) => s.beginInteraction);
  const setObjectTransform = useStore((s) => s.setObjectTransform);
  const endInteraction = useStore((s) => s.endInteraction);
  const toolMode = useUiStore((s) => s.toolMode);
  const selectionAnchor = useUiStore((s) => s.selectionAnchor);
  const drawShape = useStore((s) => s.drawShape);
  const setDraftShape = useUiStore((s) => s.setDraftShape);
  const setSelectionMarquee = useUiStore((s) => s.setSelectionMarquee);
  const [drag, setDrag] = useState<DragState | null>(null);

  const handleMouseDown = (e: CanvasMouseEvent): void => {
    if (previewMode) return;
    const next = beginWorkspaceDrag({
      e,
      ref,
      project,
      viewState,
      toolMode,
      selectedObjectId,
      selectObject,
      toggleSelectObject,
      drawShape,
    });
    if (next === null) return;
    if (next.kind === 'marquee') {
      setSelectionMarquee({ start: next.startScenePoint, end: next.startScenePoint });
    } else if (next.kind !== 'pan') {
      beginInteraction();
    }
    setDrag(next);
  };

  const handleMouseMove = (e: CanvasMouseEvent): void => {
    updateWorkspaceDrag({
      e,
      ref,
      drag,
      project,
      viewState,
      toolMode,
      setCursorMm,
      setDraftShape,
      setSelectionMarquee,
      selectionAnchor,
      setObjectTransform,
    });
  };

  const handleMouseUp = (e: CanvasMouseEvent): void => {
    setCursorMm(null);
    if (drag === null) return;
    finishWorkspaceDrag({
      drag,
      e,
      ref,
      project,
      viewState,
      drawShape,
      setDraftShape,
      selectObjects,
      setSelectionMarquee,
      endInteraction,
    });
    setDrag(null);
  };

  const handlers = dragHandlers(handleMouseDown, handleMouseMove, handleMouseUp);
  return { handlers, dragKind: visibleDragKind(drag) };
}

function dragHandlers(
  onMouseDown: DragHandlers['onMouseDown'],
  onMouseMove: DragHandlers['onMouseMove'],
  onMouseUp: DragHandlers['onMouseUp'],
): DragHandlers {
  return { onMouseDown, onMouseMove, onMouseUp };
}

function beginWorkspaceDrag(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: WorkspaceViewState;
  readonly toolMode: ReturnType<typeof useUiStore.getState>['toolMode'];
  readonly selectedObjectId: string | null;
  readonly selectObject: (id: string | null) => void;
  readonly toggleSelectObject: (id: string) => void;
  readonly drawShape: (shape: ShapeObject) => void;
}): DragState | null {
  if (args.toolMode.kind === 'draw' && args.e.button === 0 && !useUiStore.getState().spaceDown) {
    if (args.toolMode.shape === 'polyline') {
      handlePenMouseDown(args);
      return null;
    }
    return beginDrawDrag({ ...args, shape: args.toolMode.shape });
  }
  return computeMouseDownDrag({
    e: args.e,
    ref: args.ref,
    project: args.project,
    selectedObjectId: args.selectedObjectId,
    viewState: args.viewState,
    onShiftClick: args.toggleSelectObject,
    onPlainClick: args.selectObject,
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
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
  readonly selectionAnchor: SelectionAnchor;
  readonly setObjectTransform: (id: string, transform: Transform) => void;
}): void {
  const canvas = args.ref.current;
  if (args.drag?.kind === 'pan' && canvas !== null) {
    const next = panOffsetForDrag({ ...args, drag: args.drag, canvas });
    useUiStore.getState().setPan(next.panX, next.panY);
    return;
  }
  const point = canvasMouseToScene(args.e, canvas, args.project, args.viewState);
  args.setCursorMm(point);
  if (args.drag?.kind === 'marquee') {
    updateSelectionMarquee({
      drag: args.drag,
      point,
      setSelectionMarquee: args.setSelectionMarquee,
    });
    return;
  }
  if (args.toolMode.kind === 'draw' && args.toolMode.shape === 'polyline') {
    updatePenCursor(point, args.e.shiftKey);
    return;
  }
  if (args.drag?.kind === 'draw') {
    updateDrawDraft({ ...args, drag: args.drag, point });
    return;
  }
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
  if (args.drag.kind === 'marquee') {
    commitSelectionMarquee({ ...args, drag: args.drag });
    return;
  }
  if (args.drag !== null && args.drag.kind !== 'pan') args.endInteraction();
}

function updateDrawDraft(args: {
  readonly drag: Extract<DragState, { kind: 'draw' }>;
  readonly point: Vec2 | null;
  readonly project: Project;
  readonly e: CanvasMouseEvent;
  readonly setDraftShape: (shape: ShapeObject | null) => void;
}): void {
  if (args.point === null) return;
  args.setDraftShape(
    draftForDrawDrag(args.drag, args.point, args.project, drawModifiersFromEvent(args.e)),
  );
}

function updateSelectionMarquee(args: {
  readonly drag: Extract<DragState, { kind: 'marquee' }>;
  readonly point: Vec2 | null;
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
}): void {
  if (args.point === null) return;
  args.setSelectionMarquee({ start: args.drag.startScenePoint, end: args.point });
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

function applyTransformDrag(args: {
  readonly drag: DragState | null;
  readonly point: Vec2 | null;
  readonly e: CanvasMouseEvent;
  readonly project: Project;
  readonly selectionAnchor: SelectionAnchor;
  readonly setObjectTransform: (id: string, transform: Transform) => void;
}): void {
  const { drag, point } = args;
  if (
    drag === null ||
    drag.kind === 'pan' ||
    drag.kind === 'draw' ||
    drag.kind === 'marquee' ||
    point === null
  ) {
    return;
  }
  const obj = args.project.scene.objects.find((o) => o.id === drag.objectId);
  if (obj === undefined) return;
  args.setObjectTransform(
    drag.objectId,
    nextTransformForDrag(drag, obj, point, args.e, args.selectionAnchor),
  );
}

function visibleDragKind(drag: DragState | null): DragMoveResult['dragKind'] {
  if (drag === null || drag.kind === 'pan' || drag.kind === 'draw' || drag.kind === 'marquee') {
    return null;
  }
  return drag.kind;
}
