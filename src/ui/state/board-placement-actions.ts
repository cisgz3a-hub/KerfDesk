// board-placement-actions — placeSelectionOnBoard (ADR-636): move the selected
// artwork, as one block, to one of nine anchors on the placed board (corners,
// edge middles, centre) a chosen clearance in from the edge. The geometry is
// core's planBoardPlacement, which keeps artwork inside round and custom-shape
// boards; this action resolves the board and the selection and applies one
// undoable move. Artwork that cannot fit is still aligned, with a warning.

import {
  boardRegionOf,
  combinedBBox,
  findRegistrationBoxes,
  planBoardPlacement,
  sceneObjectHasVisibleLayer,
  type BoardPlacementAnchor,
  type SceneObject,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type BoardPlacementActions = {
  readonly placeSelectionOnBoard: (anchor: BoardPlacementAnchor, marginMm: number) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function boardPlacementActions(set: Setter): BoardPlacementActions {
  return {
    placeSelectionOnBoard: (anchor, marginMm) =>
      set((state) => applyPlaceSelectionOnBoard(state, anchor, marginMm)),
  };
}

function applyPlaceSelectionOnBoard(
  state: AppState,
  anchor: BoardPlacementAnchor,
  marginMm: number,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const boards = findRegistrationBoxes(scene);
  const board = boards[0];
  if (board === undefined) return state;
  const moving = placeableSelection(state, new Set(boards.map((box) => box.id)));
  const footprint = combinedBBox(moving);
  if (footprint === null) return state;
  const plan = planBoardPlacement(footprint, boardRegionOf(board), anchor, marginMm);
  if (!plan.fits) {
    useToastStore
      .getState()
      .pushToast(
        'The artwork is larger than the board inside that edge margin, so it overhangs. Use Fit to board, or a smaller margin.',
        'warning',
      );
  }
  if (Math.abs(plan.dx) < 1e-9 && Math.abs(plan.dy) < 1e-9) return state;
  const ids = new Set(moving.map((object) => object.id));
  const objects = scene.objects.map((object) =>
    ids.has(object.id)
      ? ({
          ...object,
          transform: {
            ...object.transform,
            x: object.transform.x + plan.dx,
            y: object.transform.y + plan.dy,
          },
        } as SceneObject)
      : object,
  );
  return {
    project: { ...state.project, scene: { ...scene, objects } },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// The selected artwork that can move: not a board outline, not locked, on a
// visible layer — the same objects an ordinary selection move would shift.
function placeableSelection(
  state: AppState,
  boardIds: ReadonlySet<string>,
): ReadonlyArray<SceneObject> {
  const ids = new Set(
    [state.selectedObjectId, ...state.additionalSelectedIds].filter(
      (id): id is string => id !== null && !boardIds.has(id),
    ),
  );
  return state.project.scene.objects.filter(
    (object) =>
      ids.has(object.id) &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(state.project.scene, object),
  );
}
