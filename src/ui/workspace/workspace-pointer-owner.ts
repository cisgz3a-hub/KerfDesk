import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import type { DragState } from './drag-state';
import { capturePointer, releasePointer } from './pointer-capture';
import type { useWorkspaceDragDeps } from './workspace-drag-deps';
import { cancelWorkspaceDrag } from './workspace-drag-cancel';
import { useUiStore } from '../state/ui-store';

type WorkspaceDragDeps = ReturnType<typeof useWorkspaceDragDeps>;
type ActivePointerRef = MutableRefObject<number | null>;
type SetDrag = (drag: DragState | null) => void;
type CanvasPointerEvent = ReactPointerEvent<HTMLCanvasElement>;

export type OwnedPointerHandlers = {
  readonly onPointerDown: (event: CanvasPointerEvent) => void;
  readonly onPointerMove: (event: CanvasPointerEvent) => void;
  readonly onPointerUp: (event: CanvasPointerEvent) => void;
  readonly onPointerCancel: (event: CanvasPointerEvent) => void;
  readonly onLostPointerCapture: (event: CanvasPointerEvent) => void;
};

export function createOwnedPointerHandlers(args: {
  readonly getCanvas: () => HTMLCanvasElement | null;
  readonly activePointerId: ActivePointerRef;
  readonly drag: DragState | null;
  readonly deps: WorkspaceDragDeps;
  readonly setDrag: SetDrag;
  readonly createDrag: (event: CanvasPointerEvent) => DragState | null;
  readonly move: (event: CanvasPointerEvent) => void;
  readonly finish: (event: CanvasPointerEvent, drag: DragState) => void;
}): OwnedPointerHandlers {
  const cancel = (event: CanvasPointerEvent, releaseCapture: boolean): void =>
    cancelOwnedPointerDrag({
      canvas: args.getCanvas(),
      pointerId: event.pointerId,
      activePointerId: args.activePointerId,
      drag: args.drag,
      deps: args.deps,
      setDrag: args.setDrag,
      releaseCapture,
    });
  return {
    onPointerDown: (event) =>
      beginOwnedPointerDrag({
        canvas: args.getCanvas(),
        pointerId: event.pointerId,
        activePointerId: args.activePointerId,
        deps: args.deps,
        setDrag: args.setDrag,
        createDrag: () => args.createDrag(event),
      }),
    onPointerMove: (event) => {
      if (pointerOwnsMove(args.activePointerId, args.drag, event.pointerId)) args.move(event);
    },
    onPointerUp: (event) =>
      finishOwnedPointerDrag({
        canvas: args.getCanvas(),
        pointerId: event.pointerId,
        activePointerId: args.activePointerId,
        drag: args.drag,
        deps: args.deps,
        setDrag: args.setDrag,
        finish: (drag) => args.finish(event, drag),
      }),
    onPointerCancel: (event) => cancel(event, true),
    onLostPointerCapture: (event) => cancel(event, false),
  };
}

export function beginOwnedPointerDrag(args: {
  readonly canvas: HTMLCanvasElement | null;
  readonly pointerId: number;
  readonly activePointerId: ActivePointerRef;
  readonly deps: WorkspaceDragDeps;
  readonly setDrag: SetDrag;
  readonly createDrag: () => DragState | null;
}): void {
  if (args.activePointerId.current !== null) return;
  useUiStore.getState().closeWorkspaceContextBar();
  args.deps.setSnapGuides([]);
  const drag = args.createDrag();
  if (drag === null) return;
  capturePointer(args.canvas, args.pointerId);
  args.activePointerId.current = args.pointerId;
  initializeDragSurface(drag, args.deps);
  args.setDrag(drag);
}

export function pointerOwnsMove(
  activePointerId: ActivePointerRef,
  drag: DragState | null,
  pointerId: number,
): boolean {
  return activePointerId.current === null ? drag === null : activePointerId.current === pointerId;
}

export function finishOwnedPointerDrag(args: {
  readonly canvas: HTMLCanvasElement | null;
  readonly pointerId: number;
  readonly activePointerId: ActivePointerRef;
  readonly drag: DragState | null;
  readonly deps: WorkspaceDragDeps;
  readonly setDrag: SetDrag;
  readonly finish: (drag: DragState) => void;
}): void {
  if (args.activePointerId.current !== args.pointerId) return;
  args.activePointerId.current = null;
  releasePointer(args.canvas, args.pointerId);
  args.deps.setCursorMm(null);
  args.deps.setSnapGuides([]);
  if (args.drag !== null) args.finish(args.drag);
  args.setDrag(null);
}

export function cancelOwnedPointerDrag(args: {
  readonly canvas: HTMLCanvasElement | null;
  readonly pointerId: number;
  readonly activePointerId: ActivePointerRef;
  readonly drag: DragState | null;
  readonly deps: WorkspaceDragDeps;
  readonly setDrag: SetDrag;
  readonly releaseCapture: boolean;
}): void {
  if (args.activePointerId.current !== args.pointerId) return;
  args.activePointerId.current = null;
  if (args.releaseCapture) releasePointer(args.canvas, args.pointerId);
  cancelWorkspaceDrag(args.drag, args.deps);
  args.setDrag(null);
}

export function clearOwnedPointerDrag(args: {
  readonly canvas: HTMLCanvasElement | null;
  readonly activePointerId: ActivePointerRef;
  readonly setDrag: SetDrag;
}): void {
  const pointerId = args.activePointerId.current;
  args.activePointerId.current = null;
  if (pointerId !== null) releasePointer(args.canvas, pointerId);
  args.setDrag(null);
}

function initializeDragSurface(drag: DragState, deps: WorkspaceDragDeps): void {
  if (drag.kind === 'marquee') {
    deps.setSelectionMarquee({ start: drag.startScenePoint, end: drag.startScenePoint });
  } else if (drag.kind === 'measure') {
    deps.setMeasureDraft({ start: drag.startScenePoint, end: drag.startScenePoint });
  } else if (drag.kind !== 'pan' && drag.kind !== 'draw') {
    // Draw commits own one atomic history entry; only mutating live drags need
    // the rollback snapshot used by cancellation and pointer-capture loss.
    deps.beginInteraction();
  }
}
