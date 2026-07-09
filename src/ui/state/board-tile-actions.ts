// board-tile-actions — tileSelectionIntoBoard (ADR-125 A2): tile copies of the
// single selected design across the placed board (the registration box). The
// pure geometry lives in core (tileIntoRegion); this action resolves the board
// region and the selected design, moves the original into the first grid slot,
// and adds a fresh copy for every remaining slot as one undoable edit.

import {
  boardFitRegion,
  findRegistrationBoxes,
  sceneObjectHasVisibleLayer,
  type SceneObject,
  type TileLayout,
  type TileOffset,
  tileIntoRegion,
  transformedBBox,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type BoardTileActions = {
  readonly tileSelectionIntoBoard: (layout: TileLayout) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function boardTileActions(set: Setter): BoardTileActions {
  return {
    tileSelectionIntoBoard: (layout) => set((state) => applyTileSelectionIntoBoard(state, layout)),
  };
}

function applyTileSelectionIntoBoard(
  state: AppState,
  layout: TileLayout,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const box = findRegistrationBoxes(scene)[0];
  if (box === undefined) return state;
  const target = singleSelectedDesign(state, box.id);
  if (target === undefined) return state;

  const [firstSlot, ...copySlots] = tileIntoRegion(
    transformedBBox(target),
    boardFitRegion(box),
    layout,
  );
  if (firstSlot === undefined) return state;

  // Move the original into the first slot; build a fresh copy per remaining slot
  // (crypto.randomUUID matches the duplicate action's id minting). Append all
  // copies in one pass — a per-object addObject loop is O(n²) at large counts.
  const movedOriginal = translated(target, firstSlot);
  const copies = copySlots.map((slot) => ({
    ...translated(target, slot),
    id: crypto.randomUUID(),
  }));
  const objects = scene.objects
    .map((object) => (object.id === target.id ? movedOriginal : object))
    .concat(copies);

  return {
    project: { ...state.project, scene: { ...scene, objects } },
    // Select the whole array (original + copies), like Duplicate. This also
    // disables "Array on board" (it needs exactly one selected design), so
    // re-clicking can't silently stack a second overlapping grid (double-burn) —
    // the operator undoes first to re-array.
    selectedObjectId: movedOriginal.id,
    additionalSelectedIds: new Set(copies.map((copy) => copy.id)),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function singleSelectedDesign(state: AppState, boxId: string): SceneObject | undefined {
  const ids = [state.selectedObjectId, ...state.additionalSelectedIds].filter(
    (id): id is string => id !== null && id !== boxId,
  );
  const id = ids.length === 1 ? ids[0] : undefined;
  if (id === undefined) return undefined;
  const target = state.project.scene.objects.find((object) => object.id === id);
  if (target === undefined || target.locked === true) return undefined;
  if (!sceneObjectHasVisibleLayer(state.project.scene, target)) return undefined;
  return target;
}

// as SceneObject: spreading the discriminated union widens the result, but the
// kind discriminant is preserved unchanged, so re-narrowing is sound (the same
// pattern applyDuplicate uses in scene-mutations).
function translated(object: SceneObject, offset: TileOffset): SceneObject {
  return {
    ...object,
    transform: {
      ...object.transform,
      x: object.transform.x + offset.dx,
      y: object.transform.y + offset.dy,
    },
  } as SceneObject;
}
