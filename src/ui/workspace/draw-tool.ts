// draw-tool — the draw-mode branch of the Workspace mouse handlers (ADR-051,
// Phase G, B5). Extracted from Workspace.tsx so useDragMove stays under the
// function-size cap and the draw interaction is testable without rendering.
// The Workspace owns the React drag state + listeners; these helpers translate
// a draw-mode mouse event into a DragState, a live draft ShapeObject, or a
// commit.

import {
  type DrawShapeKind,
  type DrawShapeModifiers,
  isDrawDragSignificant,
  shapeFromDrag,
} from '../../core/shapes';
import { type Project, type ShapeObject, type Vec2 } from '../../core/scene';
import { useUiStore } from '../state/ui-store';
import { type DragState } from './drag-state';
import { canvasMouseToScene } from './view-transform';

type ViewArg = { readonly zoomFactor: number; readonly panX: number; readonly panY: number };

// Fallback colour for a shape drawn into a scene that has no layers yet. With
// any layers present, the new shape inherits the current layer colour when it
// still exists, then the first layer. Scene data (the object's stroke), not UI
// chrome — exempt from the token rule (ADR-047).
// eslint-disable-next-line no-restricted-syntax
export const DEFAULT_SHAPE_COLOR = '#000000';
// Placeholder id for the live draft; the committed shape gets a fresh uuid so
// undo/redo and selection track a stable identity.
const DRAFT_SHAPE_ID = 'draft';

// Begin a draw drag from a left-button mouse-down while a draw tool is armed.
// Returns null when the point is off-canvas.
export function beginDrawDrag(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewArg;
  readonly shape: DrawShapeKind;
}): DragState | null {
  if (isLeftDoubleClick(args.e)) return null;
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  if (point === null) return null;
  return { kind: 'draw', shape: args.shape, startScenePoint: point };
}

function isLeftDoubleClick(e: { readonly button: number; readonly detail: number }): boolean {
  return e.button === 0 && e.detail >= 2;
}

// Compute the live draft for a draw-drag mouse-move, or null while the drag is
// still below the commit threshold (a click or sub-mm twitch).
export function draftForDrawDrag(
  drag: Extract<DragState, { kind: 'draw' }>,
  point: Vec2,
  project: Project,
  modifiers?: DrawShapeModifiers,
): ShapeObject | null {
  if (!isDrawDragSignificant(drag.startScenePoint, point, modifiers)) return null;
  return shapeFromDrag({
    kind: drag.shape,
    start: drag.startScenePoint,
    end: point,
    id: DRAFT_SHAPE_ID,
    color: currentDrawingColor(project),
    ...(modifiers === undefined ? {} : { modifiers }),
  });
}

export function drawModifiersFromEvent(e: {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): DrawShapeModifiers {
  return { regular: e.shiftKey, fromCenter: e.ctrlKey || e.metaKey };
}

export function currentDrawingColor(project: Project): string {
  const active = useUiStore.getState().activeLayerColor;
  if (active !== null && project.scene.layers.some((layer) => layer.color === active)) {
    return active;
  }
  return project.scene.layers[0]?.color ?? DEFAULT_SHAPE_COLOR;
}

// Commit the current draft (the last significant draft from the drag) as a real
// scene object with a fresh id, then clear it. No-op when the drag never
// cleared the threshold (draft is null), so a plain click draws nothing.
export function commitDraftShape(drawShape: (shape: ShapeObject) => void): boolean {
  const draft = useUiStore.getState().draftShape;
  if (draft === null) return false;
  drawShape({ ...draft, id: crypto.randomUUID() });
  // Return to the Select tool after drawing a shape (maintainer request,
  // 2026-07-07): landing back on Select is the expected flow and makes the
  // just-drawn shape immediately editable. This overrides the earlier sticky
  // "back-to-back" default — rule 3 lets the maintainer override parity.
  // resetToolMode also clears the committed draft.
  useUiStore.getState().resetToolMode();
  return true;
}
