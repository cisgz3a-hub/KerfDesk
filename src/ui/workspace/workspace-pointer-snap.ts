// workspace-pointer-snap — which canvas pointer gestures snap, and the glue that
// applies it (LightBurn gap LBG-F06).
//
// Point snapping runs while drawing (rectangle, ellipse, polygon, star, pen),
// measuring and dragging nodes; moving objects snaps through drag-snap.ts. With
// a drawing or measure tool armed, the marker also follows the hovering pointer,
// so the operator sees where the press will land before pressing.
//
// Alt, held at any point in a gesture, suspends snapping for as long as it is
// held. Shift keeps meaning "constrain" (square shapes, 45-degree pen and
// measure lines) and a constrained point is left to the constraint, since a
// point cannot honour both a snap target and an angle.

import type { Project, Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore, type ToolMode } from '../state/ui-store';
import type { DragState } from './drag-state';
import type { PathNodeDragState } from './path-node-drag';
import { resolvePointerSnap } from './snap/pointer-snap';
import { movingNodesFromRefs, type SnapExclusion } from './snap/snap-exclusion';
import type { SnapMarker } from './snap/snap-kinds';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';

type SnapContext =
  | { readonly kind: 'none' }
  | { readonly kind: 'free'; readonly constrained: boolean }
  | { readonly kind: 'node'; readonly drag: PathNodeDragState };

export type WorkspacePointerSnap = {
  readonly point: Vec2 | null;
  // True when this gesture's snap feedback (marker and guides) was set here.
  readonly ownsFeedback: boolean;
};

export function snapContextFor(
  drag: DragState | null,
  toolMode: ToolMode,
  shiftKey: boolean,
): SnapContext {
  if (drag !== null) {
    if (drag.kind === 'path-node') return { kind: 'node', drag };
    if (drag.kind === 'draw' || drag.kind === 'measure') {
      return { kind: 'free', constrained: shiftKey };
    }
    return { kind: 'none' };
  }
  if (toolMode.kind === 'measure') return { kind: 'free', constrained: false };
  if (toolMode.kind !== 'draw') return { kind: 'none' };
  // The pen's Shift constrains its rubber band once a line is under way.
  const penDrawing = toolMode.shape === 'polyline' && useUiStore.getState().penDraft !== null;
  return { kind: 'free', constrained: penDrawing && shiftKey };
}

// Map a canvas pointer event to the scene point the gesture should use,
// publishing the snap marker and guides. Point-less events clear them.
export function snapWorkspacePointer(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly drag: DragState | null;
  readonly toolMode: ToolMode;
}): WorkspacePointerSnap {
  const ui = useUiStore.getState();
  const raw = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
  const context = snapContextFor(args.drag, args.toolMode, args.e.shiftKey);
  if (context.kind === 'none' || raw === null) {
    ui.setSnapMarker(null);
    if (context.kind !== 'none') ui.setSnapGuides([]);
    return { point: raw, ownsFeedback: context.kind !== 'none' };
  }
  const target = context.kind === 'node' ? nodeDragSnapTarget(context.drag, args.project) : null;
  const result = resolvePointerSnap({
    project: target?.project ?? args.project,
    rawMm: raw,
    pxToMm: pxToMmForCanvas(args.canvas, args.project, args.viewState),
    settings: ui.snapSettings,
    suppressed: args.e.altKey || (context.kind === 'free' && context.constrained),
    ...(target === null ? {} : { exclusion: target.exclusion }),
  });
  ui.setSnapMarker(result.marker);
  ui.setSnapGuides(result.guides);
  return { point: result.pointMm, ownsFeedback: true };
}

// The pointer-up of a draw or measure drag re-reads its snapped end point, so
// what is committed is exactly what the marker showed.
export function snappedDragEndPoint(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly drag: DragState;
}): Vec2 | null {
  return snapWorkspacePointer({
    e: args.e,
    canvas: args.ref.current,
    project: args.project,
    viewState: args.viewState,
    drag: args.drag,
    toolMode: useUiStore.getState().toolMode,
  }).point;
}

// What a move needs to snap: the zoom's mm-per-pixel and the marker setter.
export function transformSnapDeps(
  canvas: HTMLCanvasElement | null,
  project: Project,
  viewState: ViewState,
): {
  readonly pxToMm: number;
  readonly setSnapMarker: (next: SnapMarker | null) => void;
} {
  return {
    pxToMm: pxToMmForCanvas(canvas, project, viewState),
    setSnapMarker: useUiStore.getState().setSnapMarker,
  };
}

export function clearSnapFeedback(): void {
  const ui = useUiStore.getState();
  ui.setSnapMarker(null);
  ui.setSnapGuides([]);
}

type NodeDragTarget = { readonly project: Project; readonly exclusion: SnapExclusion };

const nodeDragTargets = new WeakMap<PathNodeDragState, NodeDragTarget>();

// A node drag snaps against the scene as it was when the drag began: every
// other piece of geometry is unchanged by the drag, and the dragged path's own
// index is then built once instead of on every move. The dragged nodes, and
// what they bend, are excluded (snap-exclusion.ts). The first move of a drag
// runs before any node has moved, so the project seen then is the start state.
function nodeDragSnapTarget(drag: PathNodeDragState, project: Project): NodeDragTarget {
  const cached = nodeDragTargets.get(drag);
  if (cached !== undefined) return cached;
  const movingNodes = movingNodesFromRefs(useStore.getState().selectedPathNodes);
  const target = { project, exclusion: movingNodes === undefined ? {} : { movingNodes } };
  nodeDragTargets.set(drag, target);
  return target;
}
