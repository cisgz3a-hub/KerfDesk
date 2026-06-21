// pen-tool — the multi-click pen interaction (ADR-051, Phase G, B6). Extracted
// from Workspace.tsx so useDragMove stays under the function-size cap and the
// click->vertex decision is unit-testable. Pen state lives in ui-store.penDraft
// (NOT a DragState variant — the pen is click-driven, not drag-driven). The pure
// penClickOutcome decides start/append/close/ignore; thin canvas-coupled
// wrappers apply it. Finish gestures (Enter, double-click) live in Workspace /
// shortcuts and call finishPen.

import { assertNever, type Project, type ShapeObject, type Vec2 } from '../../core/scene';
import { createPolyline } from '../../core/shapes';
import { type PenDraft, useUiStore } from '../state/ui-store';
import { currentDrawingColor } from './draw-tool';
import { canvasMouseToScene, pxToMmForCanvas } from './view-transform';

type ViewArg = { readonly zoomFactor: number; readonly panX: number; readonly panY: number };

// A polyline needs >=2 points to finish as an open line and >=3 to close into a
// polygon (a 2-point "closed" path is a degenerate back-and-forth — LightBurn
// won't close one either).
const MIN_PEN_VERTICES_OPEN = 2;
const MIN_PEN_VERTICES_CLOSED = 3;
// Click within this many screen pixels of the first vertex closes the path.
// Pixel-based (converted to mm via the live scale) so the snap feels identical
// at any zoom — matches LightBurn's snap-to-node.
const CLOSE_THRESHOLD_PX = 10;

export type PenClickOutcome =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'start'; readonly point: Vec2 }
  | { readonly kind: 'append'; readonly point: Vec2 }
  | { readonly kind: 'close' };

// Pure: decide what a pen click does. `detail` is the DOM click count — the
// second mousedown of a double-click (detail>=2) is the finishing gesture, so it
// must NOT append a stray vertex (the dblclick handler finishes the path).
export function penClickOutcome(args: {
  readonly detail: number;
  readonly point: Vec2;
  readonly penDraft: PenDraft | null;
  readonly closeDistanceMm: number;
}): PenClickOutcome {
  if (args.detail >= 2) return { kind: 'ignore' };
  if (args.penDraft === null) return { kind: 'start', point: args.point };
  const first = args.penDraft.vertices[0];
  const isCloseable = args.penDraft.vertices.length >= MIN_PEN_VERTICES_CLOSED;
  if (first !== undefined && isCloseable && distance(args.point, first) < args.closeDistanceMm) {
    return { kind: 'close' };
  }
  return { kind: 'append', point: args.point };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Canvas-coupled wrapper: resolve the scene point + close threshold, then apply
// the pure outcome. Called from Workspace's mousedown when the pen is armed.
export function handlePenMouseDown(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewArg;
  readonly drawShape: (shape: ShapeObject) => void;
}): void {
  const rawPoint = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  if (rawPoint === null) return;
  const pxToMm = pxToMmForCanvas(args.ref.current, args.project, args.viewState);
  const penDraft = useUiStore.getState().penDraft;
  const point = constrainPenPoint(penDraft, rawPoint, args.e.shiftKey);
  const outcome = penClickOutcome({
    detail: args.e.detail,
    point,
    penDraft,
    closeDistanceMm: CLOSE_THRESHOLD_PX * pxToMm,
  });
  applyPenClickOutcome(outcome, penDraft, args.project, args.drawShape);
}

function applyPenClickOutcome(
  outcome: PenClickOutcome,
  penDraft: PenDraft | null,
  project: Project,
  drawShape: (shape: ShapeObject) => void,
): void {
  const setPenDraft = useUiStore.getState().setPenDraft;
  switch (outcome.kind) {
    case 'ignore':
      return;
    case 'start':
      setPenDraft({ vertices: [outcome.point], cursor: outcome.point });
      return;
    case 'append':
      setPenDraft({
        vertices: [...(penDraft?.vertices ?? []), outcome.point],
        cursor: outcome.point,
      });
      return;
    case 'close':
      finishPen({ closed: true, project, drawShape });
      return;
    default:
      return assertNever(outcome);
  }
}

// Update the rubber-band endpoint on mousemove. No-op when the pen isn't drawing.
export function updatePenCursor(point: Vec2 | null, constrain = false): void {
  const current = useUiStore.getState().penDraft;
  if (current === null) return;
  const cursor = point === null ? null : constrainPenPoint(current, point, constrain);
  useUiStore.getState().setPenDraft({ vertices: current.vertices, cursor });
}

export function constrainPenPoint(
  penDraft: PenDraft | null,
  point: Vec2,
  constrain: boolean,
): Vec2 {
  if (!constrain) return point;
  const anchor = penDraft?.vertices[penDraft.vertices.length - 1];
  if (anchor === undefined) return point;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return point;
  const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: anchor.x + Math.cos(snappedAngle) * length,
    y: anchor.y + Math.sin(snappedAngle) * length,
  };
}

// Commit the in-progress polyline as a kind:'shape' object, then clear the draft.
// drawShape (-> applyDrawShape) already selects it + pushes one undo, so we
// deliberately do NOT call selectObject. No-op below the min vertex count,
// leaving the draft intact so the user can keep placing points.
export function finishPen(args: {
  readonly closed: boolean;
  readonly project: Project;
  readonly drawShape: (shape: ShapeObject) => void;
}): boolean {
  const penDraft = useUiStore.getState().penDraft;
  if (penDraft === null) return false;
  const points = penDraft.vertices;
  const min = args.closed ? MIN_PEN_VERTICES_CLOSED : MIN_PEN_VERTICES_OPEN;
  if (points.length < min) return false;
  const color = currentDrawingColor(args.project);
  args.drawShape(
    createPolyline({ id: crypto.randomUUID(), color, spec: { points, closed: args.closed } }),
  );
  useUiStore.getState().setPenDraft(null);
  // Stay armed in the pen tool for back-to-back polylines (LightBurn parity +
  // ADR-051 J3); Esc or Select exit. setPenDraft(null) already cleared the draft.
  return true;
}
