// The Warp and Deform canvas tools (LightBurn gap LBG-T06). Starting one puts
// its handles on the box round the selected vector artwork: four corners for
// Warp, a 4 x 4 grid for Deform. Dragging a handle moves only the handles;
// the canvas draws the artwork bent by them (use-warp-deform-preview.ts) while
// the project stays as it was until Apply, so Cancel has nothing to undo.
// Shift while dragging a Warp corner keeps the four handles a parallelogram:
// the corner's neighbours stay put and the opposite corner follows, so the
// warp is a plain slant and stretch with no perspective.

import { initialWarpDeformHandles, type WarpDeformGrid } from '../../core/geometry/warp-deform-map';
import type { Project } from '../../core/scene/project';
import type { Vec2 } from '../../core/scene/scene-object';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { useUiStore, type ToolMode } from '../state/ui-store';
import { warpDeformRequestForSelection } from '../state/warp-deform-plan';
import { useWarpDeformSession, type WarpDeformRequest } from '../state/warp-deform-session';
import { canvasTheme } from '../theme/canvas-theme';
import {
  canvasMouseToScene,
  pxToMmForCanvas,
  type ViewState,
  type ViewTransform,
} from './view-transform';

export type WarpHandleDragState = {
  readonly kind: 'warp-handle';
  readonly index: number;
  readonly startPoint: Vec2;
  readonly startHandles: ReadonlyArray<Vec2>;
};

const HANDLE_RADIUS_PX = 7;
const HANDLE_HIT_PX = 10;
const WARP_CORNERS = 4;
const DEFORM_SIDE = 4;

/** The session the canvas is editing, or null when neither tool is on. */
export function activeWarpDeformSession(
  mode: ToolMode = useUiStore.getState().toolMode,
  session: WarpDeformRequest | null = useWarpDeformSession.getState().session,
): WarpDeformRequest | null {
  return mode.kind === 'warp-deform' && session !== null && session.grid === mode.grid
    ? session
    : null;
}

export function startWarpDeformTool(grid: WarpDeformGrid): void {
  const app = useStore.getState();
  const request = warpDeformRequestForSelection(app.project.scene, selectedObjectIds(app), grid);
  if (request === null) {
    useToastStore
      .getState()
      .pushToast(
        `Select unlocked vector artwork to ${grid === 'warp' ? 'warp' : 'deform'} first.`,
        'info',
      );
    return;
  }
  useWarpDeformSession.getState().setSession(request);
  const ui = useUiStore.getState();
  ui.closeWorkspaceContextBar();
  ui.setToolMode({ kind: 'warp-deform', grid });
}

/** Enter or Apply: bend the artwork as one undo step and return to the Select tool. */
export function applyWarpDeformTool(): void {
  const session = activeWarpDeformSession();
  if (session === null) return;
  leaveWarpDeformTool();
  useStore.getState().applyWarpDeform(session);
}

/** Esc or Cancel: return to the Select tool with the artwork as it was, still selected. */
export function cancelWarpDeformTool(): void {
  if (activeWarpDeformSession() === null) return;
  leaveWarpDeformTool();
}

export function resetWarpDeformHandles(): void {
  const session = activeWarpDeformSession();
  if (session === null) return;
  useWarpDeformSession.getState().setHandles(initialWarpDeformHandles(session.grid, session.box));
}

function leaveWarpDeformTool(): void {
  const ui = useUiStore.getState();
  ui.closeWorkspaceContextBar();
  ui.resetToolMode();
  useWarpDeformSession.getState().setSession(null);
}

/** The handle nearest `point` within reach of the pointer, or null. */
export function hitWarpDeformHandle(
  handles: ReadonlyArray<Vec2>,
  point: Vec2,
  pxToMm: number,
): number | null {
  let best: number | null = null;
  let bestDistance = HANDLE_HIT_PX * pxToMm;
  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index] as Vec2;
    const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** Pointer down with Warp or Deform on: a drag of the handle under the pointer, or null. */
export function beginWarpHandleDrag(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
}): WarpHandleDragState | null {
  const session = activeWarpDeformSession();
  const point = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
  if (session === null || point === null) return null;
  const pxToMm = pxToMmForCanvas(args.canvas, args.project, args.viewState);
  const index = hitWarpDeformHandle(session.handles, point, pxToMm);
  if (index === null) return null;
  return { kind: 'warp-handle', index, startPoint: point, startHandles: session.handles };
}

export function moveWarpHandleDrag(
  drag: WarpHandleDragState,
  point: Vec2 | null,
  keepParallelogram: boolean,
): void {
  const session = activeWarpDeformSession();
  if (session === null || point === null) return;
  useWarpDeformSession
    .getState()
    .setHandles(draggedWarpDeformHandles(session.grid, drag, point, keepParallelogram));
}

export function draggedWarpDeformHandles(
  grid: WarpDeformGrid,
  drag: WarpHandleDragState,
  point: Vec2,
  keepParallelogram: boolean,
): ReadonlyArray<Vec2> {
  const start = drag.startHandles[drag.index];
  if (start === undefined) return drag.startHandles;
  const moved = {
    x: start.x + point.x - drag.startPoint.x,
    y: start.y + point.y - drag.startPoint.y,
  };
  const next = drag.startHandles.map((handle, index) => (index === drag.index ? moved : handle));
  if (grid !== 'warp' || !keepParallelogram || next.length !== WARP_CORNERS) return next;
  const before = next[(drag.index + WARP_CORNERS - 1) % WARP_CORNERS] as Vec2;
  const after = next[(drag.index + 1) % WARP_CORNERS] as Vec2;
  next[(drag.index + 2) % WARP_CORNERS] = {
    x: before.x + after.x - moved.x,
    y: before.y + after.y - moved.y,
  };
  return next;
}

/** The dashed box the handles started on, the cage joining them, and the handles. */
export function drawWarpDeformHandles(
  ctx: CanvasRenderingContext2D,
  session: WarpDeformRequest,
  view: ViewTransform,
): void {
  const toScreen = (point: Vec2): Vec2 => ({
    x: view.offsetX + point.x * view.scale,
    y: view.offsetY + point.y * view.scale,
  });
  const { box } = session;
  const corner = toScreen({ x: box.minX, y: box.minY });
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(
    corner.x,
    corner.y,
    (box.maxX - box.minX) * view.scale,
    (box.maxY - box.minY) * view.scale,
  );
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  for (const line of cageLines(session)) {
    ctx.beginPath();
    line.map(toScreen).forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  ctx.lineWidth = 1.5;
  for (const handle of session.handles.map(toScreen)) {
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, HANDLE_RADIUS_PX - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Warp: the four sides. Deform: every row and column of the control grid.
function cageLines(session: WarpDeformRequest): ReadonlyArray<ReadonlyArray<Vec2>> {
  const at = (index: number): Vec2 | undefined => session.handles[index];
  const line = (indexes: ReadonlyArray<number>): ReadonlyArray<Vec2> =>
    indexes.flatMap((index) => at(index) ?? []);
  if (session.grid === 'warp') return [line([0, 1, 2, 3, 0])];
  const sides = Array.from({ length: DEFORM_SIDE }, (_, index) => index);
  return [
    ...sides.map((row) => line(sides.map((col) => row * DEFORM_SIDE + col))),
    ...sides.map((col) => line(sides.map((row) => row * DEFORM_SIDE + col))),
  ];
}
