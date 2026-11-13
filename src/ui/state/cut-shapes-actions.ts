// Cut Shapes (LightBurn gap LBG-T08): the top-most selected closed shape cuts
// the other selected vector objects it crosses into the part inside it and
// the part outside it, and is removed. The pieces take their source's place
// in the stacking and run order, burn with its operations, and end up
// selected so they can be moved apart. One undo step. A selection it cannot
// cut, or a cut the project cannot hold (ADR-307 amendment 1), gets a notice
// saying why, and nothing changes.

import { planCutShapes, type CutShapesPlan } from '../../core/geometry/cut-shapes';
import { isUnlockedVectorArtwork } from '../../core/geometry/trim-contours';
import type { VectorSceneObject } from '../../core/geometry';
import type { Scene, SceneObject } from '../../core/scene';
import { geometryToolSkippedNotice, geometryToolSources } from './geometry-tool-sources';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';
import { refuseSceneLimitOverrun } from './scene-copy-room';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';
import { reusableCutShapes, type PreparedCutShapes } from './vector-op-prepared';

const CUT_FEWER = 'Cut fewer shapes, or delete some objects first.';

export type CutShapesActions = {
  /**
   * Cut the selection with its top-most closed shape; true when anything was
   * cut. A background plan for this exact scene and selection is committed as
   * it is (ADR-609); otherwise the cut is planned here.
   */
  readonly cutSelectedShapes: (prepared?: PreparedCutShapes) => boolean;
};

type Setter = (
  fn: (state: AppState) => AppState | Partial<AppState>,
  onCommitted?: () => void,
) => unknown;
type Report = (notify: () => void) => void;

export function cutShapesActions(set: Setter): CutShapesActions {
  return {
    cutSelectedShapes: (prepared) => {
      let cut = false;
      const notifications: Array<() => void> = [];
      const committed = set(
        (state) => {
          const next = cutShapesMutation(state, (notify) => notifications.push(notify), prepared);
          cut = next !== state;
          return next;
        },
        () => notifications.forEach((notify) => notify()),
      );
      return committed !== false && cut;
    },
  };
}

function cutShapesMutation(
  state: AppState,
  report: Report,
  prepared?: PreparedCutShapes,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const selected = cutShapesSelection(scene, selectedObjectIds(state));
  const { sources, notice } = cutShapesSources(scene, selected);
  if (notice !== '') report(() => useToastStore.getState().pushToast(notice, 'info'));
  const plan =
    reusableCutShapes(prepared, scene, sources) ?? planCutShapes(sources, cutShapesUsedIds(scene));
  if (plan.kind === 'error') {
    report(() => useToastStore.getState().pushToast(plan.error.message, 'warning'));
    return state;
  }
  const pieces = plan.value.cuts.flatMap((cut) => cut.pieces.map((piece) => piece.id));
  const repaired = repairDanglingObjectDependencies(applyCut(scene, plan.value));
  const next = pruneOrphanLayers(repaired.scene);
  // A project past its limits saves but cannot be opened again (ADR-307
  // amendment 1): such a cut is refused whole, never made in part.
  if (refuseSceneLimitOverrun(scene, next, CUT_FEWER)) return state;
  report(() => reportDependencyRepairs(repaired));
  report(() =>
    useToastStore.getState().pushToast(cutMessage(plan.value, selected.length), 'success'),
  );
  return {
    project: { ...state.project, scene: next },
    selectedObjectId: pieces[0] ?? null,
    additionalSelectedIds: new Set(pieces.slice(1)),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack, 'Cut Shapes'),
    redoStack: [],
    dirty: true,
  };
}

/** The selected objects, in scene order; Cut Shapes works on the unlocked vector ones. */
export function cutShapesSelection(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<SceneObject> {
  const ids = new Set(selectedIds);
  return scene.objects.filter((object) => ids.has(object.id));
}

/**
 * The objects Cut Shapes cuts or cuts with. Cutting replaces them with pieces,
 * so variable data and the registration jig are left out (ADR-350 Amendment 2).
 */
export function cutShapesSources(
  scene: Scene,
  selected: ReadonlyArray<SceneObject>,
): { readonly sources: ReadonlyArray<VectorSceneObject>; readonly notice: string } {
  const { kept, skipped } = geometryToolSources(
    scene,
    selected.filter(isUnlockedVectorArtwork),
    'replace',
  );
  return { sources: kept, notice: geometryToolSkippedNotice(skipped) };
}

/** Every object id, which new piece ids avoid. */
export function cutShapesUsedIds(scene: Scene): ReadonlySet<string> {
  return new Set(scene.objects.map((object) => object.id));
}

/** The scene with each cut source replaced in place by its pieces and the cutter removed. */
function applyCut(scene: Scene, plan: CutShapesPlan): Scene {
  const pieces = new Map<string, ReadonlyArray<SceneObject>>(
    plan.cuts.map((cut) => [cut.sourceId, cut.pieces]),
  );
  const replace = <T>(id: string, keep: T, map: (piece: SceneObject) => T): ReadonlyArray<T> =>
    id === plan.cutterId ? [] : (pieces.get(id)?.map(map) ?? [keep]);
  const next: Scene = {
    ...scene,
    objects: scene.objects.flatMap((object) => replace(object.id, object, (piece) => piece)),
    ...(scene.artworkOrder === undefined
      ? {}
      : { artworkOrder: scene.artworkOrder.flatMap((id) => replace(id, id, (piece) => piece.id)) }),
  };
  return removeObjectIdsFromGroups(next, new Set([plan.cutterId, ...pieces.keys()]));
}

function cutMessage(plan: CutShapesPlan, selectedCount: number): string {
  const shapes = plan.cuts.length;
  const pieces = plan.cuts.reduce((sum, cut) => sum + cut.pieces.length, 0);
  const others = selectedCount - shapes - 1;
  const left =
    others <= 0
      ? ''
      : ` ${others === 1 ? '1 other selected object was' : `${others} other selected objects were`} left as ${others === 1 ? 'it was' : 'they were'}.`;
  return `Cut ${shapes === 1 ? '1 shape' : `${shapes} shapes`} into ${pieces} pieces.${left}`;
}
