import {
  buildSelectionMatchSizeEdit,
  type SelectionMatchSizeKind,
} from '../../core/scene/selection-match-size';
import {
  buildSelectionMoveTogetherEdit,
  type SelectionMoveTogetherAxis,
} from '../../core/scene/selection-move-together';
import {
  type BoardAnchor,
  boardFitRegion,
  buildBoxAnchorAlign,
  buildSelectionAlignEdit,
  buildSelectionDistributeEdit,
  buildSelectionFlipEdit,
  buildSelectionNudgeEdit,
  findRegistrationBoxes,
  fitObjectToRegion,
  sceneObjectHasVisibleLayer,
  type Project,
  type Scene,
  type SceneObject,
  type SelectionAlignKind,
  type SelectionDistributeKind,
  type SelectionFlipAxis,
  type Transform,
  type Vec2,
} from '../../core/scene';
import {
  buildSelectionMoveToBedEdit,
  buildSelectionQuarterTurnEdit,
  type QuarterTurnDirection,
} from '../../core/scene/selection-placement';
import { buildSelectionDockEdit, type DockOptions } from '../../core/scene/selection-dock';
import {
  buildSelectionRotateByEdit,
  buildSelectionRotateScaleEdit,
} from '../../core/scene/selection-rotate';
import type { SelectionAnchor } from '../../core/scene/selection-transform';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import { applyCenterArtworkInRegistrationJigSet } from './registration-jig-artwork-actions';
import { selectionReferenceId, type SelectionReferenceState } from './selection-reference';
import { useToastStore } from './toast-store';
import { fitObjectToBoard, type BoardFitOptions } from '../../core/scene/fit-object-to-board';

export type SelectionTransformEdit = {
  readonly id: string;
  readonly transform: Transform;
};

// The selection's click order, which Align reads, lives with these actions.
export type SelectionTransformActions = SelectionReferenceState & {
  readonly applySelectionTransforms: (edits: ReadonlyArray<SelectionTransformEdit>) => void;
  readonly alignSelection: (kind: SelectionAlignKind) => void;
  readonly distributeSelection: (kind: SelectionDistributeKind) => void;
  readonly matchSelectionSize: (kind: SelectionMatchSizeKind, proportional: boolean) => void;
  readonly moveSelectionTogether: (axis: SelectionMoveTogetherAxis) => void;
  readonly nudgeSelection: (dx: number, dy: number) => void;
  readonly flipSelection: (axis: SelectionFlipAxis) => void;
  // ADR-410: Rotate 90° about the selection centre (+1 clockwise on screen).
  readonly rotateSelectionQuarterTurn: (direction: QuarterTurnDirection) => void;
  /** Turns the whole selection by `deltaDeg` about its combined centre, as one undo step. */
  readonly rotateSelectionBy: (deltaDeg: number) => void;
  /** Dock: slide the selection until it meets other artwork or the bed edge. */
  readonly dockSelection: (options: DockOptions) => void;
  /** Two-Point Rotate / Scale: turn and uniformly scale the selection about `pivot`. */
  readonly rotateScaleSelectionAbout: (pivot: Vec2, deltaDeg: number, scale: number) => void;
  // ADR-410: Move Selected Objects to the bed centre, a corner or an edge.
  readonly moveSelectionToBed: (anchor: SelectionAnchor) => void;
  // ADR-057: proportionally fit the selected artwork in the first jig outline,
  // retaining it there and copying the fitted layout into every remaining outline.
  readonly centerSelectionInRegistrationBox: () => void;
  // ADR-124: snap the selected artwork to a corner (or the center) of the
  // captured-board outline — the registration box the operator built from jogged
  // corners. Same reference-box semantics as centering.
  readonly alignSelectionToRegistrationBox: (anchor: BoardAnchor) => void;
  // ADR-125 A1: scale + center the single selected design so it fills the placed
  // board (the registration box) with a margin.
  readonly fitSelectionToBoard: (options?: BoardFitOptions) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function selectionTransformActions(set: Setter): SelectionTransformActions {
  return {
    applySelectionTransforms: (edits) =>
      set((state) => applySelectionTransformsToState(state, edits)),
    alignSelection: (kind) => set((state) => applySelectionAlignToState(state, kind)),
    distributeSelection: (kind) => set((state) => applySelectionDistributeToState(state, kind)),
    matchSelectionSize: (kind, proportional) =>
      set((state) => applySelectionMatchSizeToState(state, kind, proportional)),
    moveSelectionTogether: (axis) => set((state) => applySelectionMoveTogetherToState(state, axis)),
    nudgeSelection: (dx, dy) => set((state) => applySelectionNudgeToState(state, dx, dy)),
    flipSelection: (axis) => set((state) => applySelectionFlipToState(state, axis)),
    rotateSelectionQuarterTurn: (direction) =>
      set((state) => applySelectionQuarterTurnToState(state, direction)),
    rotateSelectionBy: (deltaDeg) =>
      set((state) => {
        const objects = selectedObjects(state.project.scene, selectedObjectIds(state));
        const result = buildSelectionRotateByEdit(objects, deltaDeg);
        return result.kind === 'error'
          ? state
          : applySelectionTransformsToState(state, result.transforms);
      }),
    dockSelection: (options) =>
      set((state) => {
        const scene = state.project.scene;
        const ids = new Set(selectedObjectIds(state));
        const objects = selectedObjects(scene, [...ids]);
        const obstacles = scene.objects.filter(
          (object) => !ids.has(object.id) && sceneObjectHasVisibleLayer(scene, object),
        );
        const { bedWidth, bedHeight } = state.project.device;
        const edits = buildSelectionDockEdit(
          objects,
          obstacles,
          options,
          { width: bedWidth, height: bedHeight },
          scene.groups ?? [],
        );
        return applySelectionTransformsToState(state, edits);
      }),
    rotateScaleSelectionAbout: (pivot, deltaDeg, scale) =>
      set((state) => {
        const objects = selectedObjects(state.project.scene, selectedObjectIds(state));
        const result = buildSelectionRotateScaleEdit(objects, deltaDeg, scale, pivot);
        return result.kind === 'error'
          ? state
          : applySelectionTransformsToState(state, result.transforms);
      }),
    moveSelectionToBed: (anchor) => set((state) => applySelectionMoveToBedToState(state, anchor)),
    centerSelectionInRegistrationBox: () =>
      set((state) => applyCenterArtworkInRegistrationJigSet(state)),
    alignSelectionToRegistrationBox: (anchor) =>
      set((state) => applyAnchorToRegistrationBoxToState(state, anchor)),
    fitSelectionToBoard: (options) =>
      set((state) => applyFitSelectionToBoardToState(state, options)),
  };
}

// Snap the selected artwork to a corner or the center of the registration jig
// box (ADR-057 centering, ADR-124 corners). The box is the alignment reference
// (so it stays put) and is also locked, so even if it is part of the selection
// applySelectionTransformsToState skips it. No-op when no jig exists or only the
// box is selected.
function applyAnchorToRegistrationBoxToState(
  state: AppState,
  anchor: BoardAnchor,
): AppState | Partial<AppState> {
  const box = findRegistrationBoxes(state.project.scene)[0];
  if (box === undefined) return state;
  const artIds = selectedObjectIds(state).filter((id) => id !== box.id);
  if (artIds.length === 0) return state;
  const objects = [...selectedObjects(state.project.scene, artIds), box];
  const result = buildBoxAnchorAlign(objects, box.id, anchor, state.project.scene.groups ?? []);
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

// ADR-125 A1: scale + center the single selected design so it fills the placed
// board (the registration box) with a 10% margin. Single-object only — fitting
// several designs would pile them all onto the board, so multi-select is a
// no-op (the UI disables Fit-to-board unless exactly one design is selected).
const BOARD_FIT_MARGIN_FRACTION = 0.9;

function applyFitSelectionToBoardToState(
  state: AppState,
  options?: BoardFitOptions,
): AppState | Partial<AppState> {
  const box = findRegistrationBoxes(state.project.scene)[0];
  if (box === undefined) return state;
  const objects = selectedObjects(
    state.project.scene,
    selectedObjectIds(state).filter((id) => id !== box.id),
  );
  const target = objects[0];
  if (target === undefined || objects.length !== 1) return state;
  if (options !== undefined) {
    const plan = fitObjectToBoard(target, box, options);
    if (plan.kind === 'error') {
      useToastStore.getState().pushToast(plan.message, 'warning');
      return state;
    }
    return applySelectionTransformsToState(state, [
      { id: target.id, transform: plan.object.transform },
    ]);
  }
  const fitted = fitObjectToRegion(target, boardFitRegion(box), {
    marginFraction: BOARD_FIT_MARGIN_FRACTION,
    grow: true,
  });
  return applySelectionTransformsToState(state, [{ id: target.id, transform: fitted.transform }]);
}

// The reference is the object last clicked into the selection, as in LightBurn.
// A selection made at once (a marquee, Select All) has no click order, so it
// falls back to the last selected id, which is the top-most in the stack.
function applySelectionAlignToState(
  state: AppState,
  kind: SelectionAlignKind,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const { objects, referenceId } = referencedSelection(state);
  if (referenceId === undefined) return state;
  const result = buildSelectionAlignEdit(objects, { kind, referenceId }, scene.groups ?? []);
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

// Make Same Width / Height take the same reference as Align.
function applySelectionMatchSizeToState(
  state: AppState,
  kind: SelectionMatchSizeKind,
  proportional: boolean,
): AppState | Partial<AppState> {
  const { objects, referenceId } = referencedSelection(state);
  if (referenceId === undefined) return state;
  const result = buildSelectionMatchSizeEdit(
    objects,
    { kind, referenceId, proportional },
    state.project.scene.groups ?? [],
  );
  if (result.kind === 'error') return state;
  if (result.skipped > 0) {
    const count = result.skipped === 1 ? '1 rotated object' : `${result.skipped} rotated objects`;
    useToastStore
      .getState()
      .pushToast(
        `Left ${count} unchanged: stretching one side would skew it. Use the Proportional command, or turn it to a right angle first.`,
        'info',
      );
  }
  return applySelectionTransformsToState(state, result.transforms);
}

// Move H / V Together keep the reference unit fixed, as Align does.
function applySelectionMoveTogetherToState(
  state: AppState,
  axis: SelectionMoveTogetherAxis,
): AppState | Partial<AppState> {
  const { objects, referenceId } = referencedSelection(state);
  if (referenceId === undefined) return state;
  const result = buildSelectionMoveTogetherEdit(
    objects,
    { axis, referenceId },
    state.project.scene.groups ?? [],
  );
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function referencedSelection(state: AppState): {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly referenceId: string | undefined;
} {
  const ids = selectedObjectIds(state);
  const objects = selectedObjects(state.project.scene, ids);
  const clickedId = selectionReferenceId(state);
  const referenceId =
    clickedId !== null && objects.some((object) => object.id === clickedId)
      ? clickedId
      : ids[ids.length - 1];
  return { objects, referenceId };
}

function applySelectionDistributeToState(
  state: AppState,
  kind: SelectionDistributeKind,
): AppState | Partial<AppState> {
  const ids = selectedObjectIds(state);
  const scene = state.project.scene;
  const result = buildSelectionDistributeEdit(
    selectedObjects(scene, ids),
    { kind },
    scene.groups ?? [],
  );
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionNudgeToState(
  state: AppState,
  dx: number,
  dy: number,
): AppState | Partial<AppState> {
  const ids = selectedObjectIds(state);
  const result = buildSelectionNudgeEdit(selectedObjects(state.project.scene, ids), dx, dy);
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionFlipToState(
  state: AppState,
  axis: SelectionFlipAxis,
): AppState | Partial<AppState> {
  const ids = selectedObjectIds(state);
  const result = buildSelectionFlipEdit(selectedObjects(state.project.scene, ids), axis);
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionQuarterTurnToState(
  state: AppState,
  direction: QuarterTurnDirection,
): AppState | Partial<AppState> {
  const objects = selectedObjects(state.project.scene, selectedObjectIds(state));
  const result = buildSelectionQuarterTurnEdit(objects, direction);
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionMoveToBedToState(
  state: AppState,
  anchor: SelectionAnchor,
): AppState | Partial<AppState> {
  const objects = selectedObjects(state.project.scene, selectedObjectIds(state));
  const { bedWidth, bedHeight } = state.project.device;
  const result = buildSelectionMoveToBedEdit(
    objects,
    { width: bedWidth, height: bedHeight },
    anchor,
  );
  if (result.kind === 'error') return state;
  return applySelectionTransformsToState(state, result.transforms);
}

function applySelectionTransformsToState(
  state: AppState,
  edits: ReadonlyArray<SelectionTransformEdit>,
): AppState | Partial<AppState> {
  if (edits.length === 0) return state;
  const byId = new Map(edits.map((edit) => [edit.id, edit.transform]));
  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        const transform = byId.get(object.id);
        if (transform === undefined) return object;
        if (object.locked === true) return object;
        if (!sceneObjectHasVisibleLayer(state.project.scene, object)) return object;
        changed = true;
        return { ...object, transform };
      }),
    },
  };
  if (!changed) return state;
  return {
    project: nextProject,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function selectedObjectIds(state: AppState): ReadonlyArray<string> {
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}

function selectedObjects(scene: Scene, ids: ReadonlyArray<string>): ReadonlyArray<SceneObject> {
  return ids
    .map((id) => scene.objects.find((object) => object.id === id))
    .filter(
      (object): object is SceneObject =>
        object !== undefined && object.locked !== true && sceneObjectHasVisibleLayer(scene, object),
    );
}
