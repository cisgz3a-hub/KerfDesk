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
import { useStore } from '../state';
import { materializeCurves } from '../state/path-node-curve-command-actions';
import { boundsForPaths } from '../state/path-node-edit-geometry';
import { synchronizePolylineShapeGeometry } from '../state/path-node-shape-sync';
import { currentDrawingColor } from './draw-tool';
import { continuationOtherEnd, penEndpointAt } from './pen-continuation';
import { penContour, penHasHandles } from './pen-curve';
import { pxToMmForCanvas } from './view-transform';
import { snapWorkspacePointer } from './workspace-pointer-snap';

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
// A press that moves less than this is a corner click, not a curve-node drag.
const MIN_HANDLE_MM = 0.05;

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
  // Snapped like the drawing tools (LBG-F06), except while Shift constrains.
  const { point: rawPoint } = snapWorkspacePointer({
    e: args.e,
    canvas: args.ref.current,
    project: args.project,
    viewState: args.viewState,
    drag: null,
    toolMode: { kind: 'draw', shape: 'polyline' },
  });
  if (rawPoint === null) return;
  const radiusMm =
    CLOSE_THRESHOLD_PX * pxToMmForCanvas(args.ref.current, args.project, args.viewState);
  const penDraft = useUiStore.getState().penDraft;
  if (startOnEndpoint(penDraft, args.e.detail, args.project, rawPoint, radiusMm)) return;
  const point = constrainPenPoint(penDraft, rawPoint, args.e.shiftKey);
  if (closeOntoOtherEnd(penDraft, args.e.detail, args.project, point, radiusMm)) {
    finishPen({ closed: true, project: args.project, drawShape: args.drawShape });
    return;
  }
  const outcome = penClickOutcome({
    detail: args.e.detail,
    point,
    penDraft,
    // Continuing a path closes on its other end, never on the start it grew from.
    closeDistanceMm: penDraft?.continueFrom === undefined ? radiusMm : 0,
  });
  applyPenClickOutcome(outcome, penDraft, args.project, args.drawShape);
}

// The first click on an open endpoint of existing artwork continues that path.
function startOnEndpoint(
  penDraft: PenDraft | null,
  detail: number,
  project: Project,
  point: Vec2,
  radiusMm: number,
): boolean {
  if (penDraft !== null || detail >= 2) return false;
  const start = penEndpointAt(project, point, radiusMm);
  if (start === null) return false;
  useUiStore.getState().setPenDraft({
    vertices: [start.point],
    cursor: start.point,
    handles: [null],
    continueFrom: start.continuation,
  });
  return true;
}

// While continuing a path, a click on its other end lands there and closes it.
function closeOntoOtherEnd(
  penDraft: PenDraft | null,
  detail: number,
  project: Project,
  point: Vec2,
  radiusMm: number,
): boolean {
  if (penDraft?.continueFrom === undefined || detail >= 2) return false;
  const other = continuationOtherEnd(project, penDraft.continueFrom);
  if (other === null || distance(point, other) >= radiusMm) return false;
  useUiStore.getState().setPenDraft({
    ...penDraft,
    vertices: [...penDraft.vertices, other],
    handles: [...penHandles(penDraft), null],
  });
  return true;
}

function penHandles(penDraft: PenDraft): ReadonlyArray<Vec2 | null> {
  return penDraft.handles ?? penDraft.vertices.map(() => null);
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
      setPenDraft({ vertices: [outcome.point], cursor: outcome.point, handles: [null] });
      return;
    case 'append':
      setPenDraft({
        ...penDraft,
        vertices: [...(penDraft?.vertices ?? []), outcome.point],
        cursor: outcome.point,
        handles: [...(penDraft === null ? [] : penHandles(penDraft)), null],
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
// With the button still held after placing a vertex, the drag pulls out its
// Bezier handle instead (LightBurn click-and-drag for a curve node).
export function updatePenCursor(point: Vec2 | null, constrain = false, dragging = false): void {
  const current = useUiStore.getState().penDraft;
  if (current === null) return;
  const last = current.vertices.length - 1;
  const vertex = current.vertices[last];
  if (dragging && point !== null && vertex !== undefined) {
    const handles = [...penHandles(current)];
    handles[last] = distance(point, vertex) < MIN_HANDLE_MM ? null : point;
    useUiStore.getState().setPenDraft({ ...current, handles, cursor: point });
    return;
  }
  const cursor = point === null ? null : constrainPenPoint(current, point, constrain);
  useUiStore.getState().setPenDraft({ ...current, cursor });
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
  if (penDraft.continueFrom !== undefined) return finishContinuation(penDraft, args.closed);
  const min = args.closed ? MIN_PEN_VERTICES_CLOSED : MIN_PEN_VERTICES_OPEN;
  if (points.length < min) return false;
  const color = currentDrawingColor(args.project);
  const shape = createPolyline({
    id: crypto.randomUUID(),
    color,
    spec: { points, closed: args.closed },
  });
  args.drawShape(
    penHasHandles(penDraft.handles) ? curvedPenShape(shape, penDraft, args.closed) : shape,
  );
  // Return to the Select tool after finishing a polyline (maintainer request,
  // 2026-07-07), matching the drag-drawn shapes — rule 3 lets the maintainer
  // override the earlier sticky default. resetToolMode also clears the draft.
  useUiStore.getState().resetToolMode();
  return true;
}

// A drawing with dragged nodes keeps its exact Bezier segments instead of the
// fitted outline a plain click-by-click polyline gets.
function curvedPenShape(shape: ShapeObject, penDraft: PenDraft, closed: boolean): ShapeObject {
  const contour = penContour(penDraft.vertices, penHandles(penDraft), closed);
  const source = shape.paths[0];
  const path =
    contour === null || source === undefined ? null : materializeCurves(source, [contour]);
  if (path === null) return shape;
  return synchronizePolylineShapeGeometry(shape, [path], boundsForPaths([path])) ?? shape;
}

// Continuing a path: join the drawn stretch onto the endpoint it began on.
function finishContinuation(penDraft: PenDraft, closed: boolean): boolean {
  const from = penDraft.continueFrom;
  const contour = penContour(penDraft.vertices, penHandles(penDraft), false);
  if (from === undefined || contour === null) return false;
  const extended = useStore.getState().extendPathContour(from, contour, closed);
  if (extended) useUiStore.getState().resetToolMode();
  return extended;
}
