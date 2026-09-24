// pen-tool — the Draw Lines (pen) interaction (ADR-051 B6, ADR-380). A click
// places a corner node exactly where it lands; press-and-drag places a smooth
// node and pulls out its handles; S switches clicks between corner and smooth
// nodes; pressing the first node closes the path. Starting on an open end of
// an existing path continues it and finishing on one joins it, unless Ctrl/Cmd
// is held. Pen state lives in ui-store (penDraft, penHover, penNodeMode); a
// press that places a node returns a 'pen-node' drag so the pointer owner
// routes the handle drag back here. Enter, double-click, Escape and a right
// click finish the path through finishPen.
// https://docs.lightburnsoftware.com/2.1/Reference/DrawLines/

import type { Project, ShapeObject } from '../../core/scene';
import { commitPenPlan } from '../state/pen-path-commit';
import { planPenCommit } from '../state/pen-path-join';
import { useUiStore } from '../state/ui-store';
import { currentDrawingColor } from './draw-tool';
import { appendPenNode, penNodeForMode, type PenDraft, type PenEndpointRef } from './pen-draft';
import { PEN_DRAG_THRESHOLD_PX, type PenNodeDragState } from './pen-node-drag';
import { penModifiers, resolvePenPointer, type PenPointer } from './pen-pointer';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';

type CanvasMouseEvent = React.MouseEvent<HTMLCanvasElement>;
type CanvasRef = React.RefObject<HTMLCanvasElement | null>;
type DrawShape = (shape: ShapeObject) => void;

export function isPenToolArmed(
  toolMode: ReturnType<typeof useUiStore.getState>['toolMode'],
): boolean {
  return toolMode.kind === 'draw' && toolMode.shape === 'polyline';
}

/**
 * A primary press with the pen armed. Returns the drag that shapes the node it
 * placed, or null when the press finished the path or did nothing.
 */
export function handlePenMouseDown(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly drawShape: DrawShape;
}): PenNodeDragState | null {
  // The second press of a double-click is the finishing gesture; the dblclick
  // handler finishes the path, so it must not place a stray node.
  if (args.e.detail >= 2) return null;
  const at = penPointerAt(args);
  if (at === null) return null;
  const { pointer } = at;
  const thresholdMm = PEN_DRAG_THRESHOLD_PX * at.pxToMm;
  const ui = useUiStore.getState();
  ui.setPenHover(null);
  const draft = ui.penDraft;
  if (draft !== null && pointer.endpoint !== null) {
    // Reaching another open end (or the far end of the continued path)
    // places the last node on it and finishes at once.
    ui.setPenDraft(appendPenNode(draft, penNodeForMode(pointer.point, 'corner')));
    finishPen({
      closed: false,
      project: args.project,
      drawShape: args.drawShape,
      joinTo: pointer.endpoint,
    });
    return null;
  }
  if (draft !== null && pointer.intent === 'close') {
    return nodeDrag(draft, draft, 0, thresholdMm, true);
  }
  const node = penNodeForMode(pointer.point, ui.penNodeMode);
  const next: PenDraft =
    draft === null
      ? { nodes: [node], ...(pointer.endpoint === null ? {} : { continues: pointer.endpoint }) }
      : appendPenNode(draft, node);
  ui.setPenDraft(next);
  return nodeDrag(next, draft, next.nodes.length - 1, thresholdMm, false);
}

function nodeDrag(
  draft: PenDraft,
  before: PenDraft | null,
  nodeIndex: number,
  thresholdMm: number,
  closeOnRelease: boolean,
): PenNodeDragState | null {
  const original = draft.nodes[nodeIndex];
  if (original === undefined) return null;
  return { kind: 'pen-node', nodeIndex, original, before, closeOnRelease, thresholdMm };
}

/** Release of a node press: a pressed first node closes the path. */
export function finishPenNodeDrag(
  drag: PenNodeDragState,
  project: Project,
  drawShape: DrawShape,
): void {
  if (drag.closeOnRelease) finishPen({ closed: true, project, drawShape });
}

/** Pointer move with no button held: show where a press would land. */
export function updatePenHover(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: ViewState;
}): void {
  const pointer = penPointerAt(args)?.pointer ?? null;
  useUiStore
    .getState()
    .setPenHover(
      pointer === null
        ? null
        : { point: pointer.point, snap: pointer.snap, intent: pointer.intent },
    );
}

function penPointerAt(args: {
  readonly e: CanvasMouseEvent;
  readonly ref: CanvasRef;
  readonly project: Project;
  readonly viewState: ViewState;
}): { readonly pointer: PenPointer; readonly pxToMm: number } | null {
  const raw = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  if (raw === null) return null;
  const ui = useUiStore.getState();
  const pxToMm = pxToMmForCanvas(args.ref.current, args.project, args.viewState);
  const pointer = resolvePenPointer({
    project: args.project,
    draft: ui.penDraft,
    raw,
    pxToMm,
    settings: ui.snapSettings,
    modifiers: penModifiers(args.e),
  });
  return { pointer, pxToMm };
}

/**
 * Commit the unfinished path: a new drawing, or the existing path it continued
 * or joined, as one undo step. Returns false, leaving the draft in place, when
 * there are too few nodes to finish.
 */
export function finishPen(args: {
  readonly closed: boolean;
  readonly project: Project;
  readonly drawShape: DrawShape;
  readonly joinTo?: PenEndpointRef;
}): boolean {
  const draft = useUiStore.getState().penDraft;
  if (draft === null) return false;
  const plan = planPenCommit({
    project: args.project,
    draft,
    closed: args.closed,
    ...(args.joinTo === undefined ? {} : { joinTo: args.joinTo }),
    id: crypto.randomUUID(),
    color: currentDrawingColor(args.project),
  });
  if (plan === null) return false;
  commitPenPlan(plan, args.drawShape);
  // Return to the Select tool after finishing a path (maintainer request,
  // 2026-07-07), matching the drag-drawn shapes. resetToolMode also clears
  // the draft, the hover marker and S mode.
  useUiStore.getState().resetToolMode();
  return true;
}

/**
 * A right click ends an unfinished path, as LightBurn's Draw Lines does. A
 * lone first node has nothing to finish and is dropped. Returns true when the
 * click was the pen's.
 */
export function finishPenByRightClick(project: Project, drawShape: DrawShape): boolean {
  const ui = useUiStore.getState();
  if (!isPenToolArmed(ui.toolMode) || ui.penDraft === null) return false;
  if (!finishPen({ closed: false, project, drawShape })) ui.setPenDraft(null);
  return true;
}
