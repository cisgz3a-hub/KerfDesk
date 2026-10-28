// board-tile-actions — tileSelectionIntoBoard (ADR-125 A2): tile copies of the
// single selected design across the placed board (the registration box). The
// pure geometry lives in core (tileIntoRegion); this action resolves the board
// region and the selected design, moves the original into the first grid slot,
// and adds a fresh copy for every remaining slot as one undoable edit. An array
// the project cannot hold (ADR-307 amendment 1) is refused with a notice.
//
// A design is the object and what it needs with it: a photo's mask and a path
// text's guide move with the original, and every slot gets its own copy of
// them, as Duplicate and Array do (ADR-633 Amendment 3).

import {
  findRegistrationBoxes,
  isRegistrationBox,
  sceneObjectHasVisibleLayer,
  type Scene,
  type SceneObject,
  type TileLayout,
  type TileOffset,
  transformedBBox,
} from '../../core/scene';
import { planBoardArray } from '../../core/scene/board-array-plan';
import { refuseSceneLimitOverrun } from './scene-copy-room';
import { pushUndo } from './scene-mutations';
import {
  remapSceneObjectCopyDependencies,
  sceneObjectCopyClosure,
  sceneObjectCopyDependencyId,
} from './scene-object-copy-dependencies';
import type { AppState } from './store';

export type BoardTileActions = {
  readonly tileSelectionIntoBoard: (layout: TileLayout) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

type BoardArraySelection = Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'> & {
  readonly project: Pick<AppState['project'], 'scene'>;
};

const ARRAY_ON_BOARD_FEWER = 'Array fewer copies on the board, or delete some objects first.';

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
  const target = selectedBoardArrayDesign(state);
  if (target === undefined) return state;

  const [firstSlot, ...copySlots] = planBoardArray(transformedBBox(target), box, layout).offsets;
  if (firstSlot === undefined) return state;

  // Move the original and its mask or guide into the first slot; build fresh
  // copies per remaining slot (crypto.randomUUID matches the duplicate action's
  // id minting), each pointing at its own slot's mask or guide. A board used as
  // a mask stays put, so every copy burns through it. Append all copies in one
  // pass — a per-object addObject loop is O(n²) at large counts.
  const design = sceneObjectCopyClosure(scene.objects, new Set([target.id])).filter(
    (object) => !isRegistrationBox(object),
  );
  const moved = new Map(design.map((object) => [object.id, translated(object, firstSlot)]));
  const selectedIds = new Set(selectedNonBoardIds(state));
  const copies = copySlots.flatMap((slot) => slotCopies(design, slot));
  const objects = scene.objects
    .map((object) => moved.get(object.id) ?? object)
    .concat(copies.map((copy) => copy.object));
  const next = { ...scene, objects };
  // A project past its limits saves but cannot be opened again (ADR-307
  // amendment 1): such an array is refused whole, never made in part.
  if (refuseSceneLimitOverrun(scene, next, ARRAY_ON_BOARD_FEWER)) return state;

  return {
    project: { ...state.project, scene: next },
    // Select the whole array (original + copies) of what was selected, like
    // Duplicate. This also disables "Array on board" (it needs exactly one
    // selected design), so re-clicking can't silently stack a second
    // overlapping grid (double-burn) — the operator undoes first to re-array.
    selectedObjectId: target.id,
    additionalSelectedIds: new Set([
      ...[...selectedIds].filter((id) => id !== target.id),
      ...copies.filter((copy) => selectedIds.has(copy.sourceId)).map((copy) => copy.object.id),
    ]),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function slotCopies(
  design: ReadonlyArray<SceneObject>,
  slot: TileOffset,
): ReadonlyArray<{ readonly sourceId: string; readonly object: SceneObject }> {
  const copiedIds = new Map(design.map((object) => [object.id, crypto.randomUUID()] as const));
  return design.map((object) => {
    const copy = { ...translated(object, slot), id: copiedIds.get(object.id) ?? object.id };
    // Board copies keep their SVG re-import identity, as they always have.
    return {
      sourceId: object.id,
      object: remapSceneObjectCopyDependencies(copy, copiedIds, { preserveSvgImport: true }),
    };
  });
}

/**
 * The one design Array on board tiles: a single selected object, or one whose
 * mask or path-text guide is selected with it (they travel with it anyway).
 */
export function selectedBoardArrayDesign(state: BoardArraySelection): SceneObject | undefined {
  const scene = state.project.scene;
  const target = singleDesign(scene, selectedNonBoardIds(state));
  if (target === undefined || target.locked === true) return undefined;
  if (!sceneObjectHasVisibleLayer(scene, target)) return undefined;
  return target;
}

/** Fit to board scales exactly one object, so it admits no mask or guide beside it. */
export function selectedBoardFitDesign(state: BoardArraySelection): SceneObject | undefined {
  return selectedNonBoardIds(state).length === 1 ? selectedBoardArrayDesign(state) : undefined;
}

function selectedNonBoardIds(state: BoardArraySelection): ReadonlyArray<string> {
  const boxIds = new Set(findRegistrationBoxes(state.project.scene).map((box) => box.id));
  return [
    ...new Set(
      [state.selectedObjectId, ...state.additionalSelectedIds].filter(
        (id): id is string => id !== null && !boxIds.has(id),
      ),
    ),
  ];
}

// The design is the one selected object no other selected object depends on,
// provided everything else selected travels with it.
function singleDesign(scene: Scene, ids: ReadonlyArray<string>): SceneObject | undefined {
  const idSet = new Set(ids);
  const selected = scene.objects.filter((object) => idSet.has(object.id));
  if (selected.length !== ids.length) return undefined;
  const dependencies = new Set(selected.map(sceneObjectCopyDependencyId));
  const roots = selected.filter((object) => !dependencies.has(object.id));
  const target = roots.length === 1 ? roots[0] : undefined;
  if (target === undefined || ids.length === 1) return target;
  const closure = new Set(
    sceneObjectCopyClosure(scene.objects, new Set([target.id])).map((object) => object.id),
  );
  return ids.every((id) => closure.has(id)) ? target : undefined;
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
