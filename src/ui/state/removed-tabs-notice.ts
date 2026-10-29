// The note for an edit that replaces artwork with a new outline and so drops
// the tabs placed by hand on it: Weld, Subtract / Intersect / Exclude and
// Offset Shapes with their originals deleted (ADR-494 Amendment 3). ADR-156
// lets an edit that changes an outline's shape drop them, and the new outline
// then takes its operation's automatic tabs; the note names the loss, as
// Extend's does.

import type { SceneObject } from '../../core/scene';
import { selectedObjectIds } from './scene-group-actions';
import { useToastStore } from './toast-store';
import type {
  VectorCombineOptions,
  VectorPathMutation,
  VectorPathSet,
  VectorPathState,
} from './vector-path-actions';
import { expectedSelection, selectedVectorObjects } from './vector-path-selection';

/** The note when any of `removed` carried tabs placed by hand; empty otherwise. */
export function removedTabsNotice(removed: ReadonlyArray<SceneObject>, what: string): string {
  return removed.some(hasPlacedTabs)
    ? `Placed tabs on the ${what} were removed. Undo restores them.`
    : '';
}

/** Weld or a Boolean through `set`. The combined outline has none of the
 *  selection's tabs placed by hand, so when it replaces the selection the note
 *  says so once the edit commits; kept originals keep theirs. */
export function combineSelectionNotingTabs(
  set: VectorPathSet,
  options: VectorCombineOptions,
  what: string,
  combine: (state: VectorPathState) => VectorPathMutation | VectorPathState,
): void {
  let notice = '';
  set(
    (state) => {
      if (!expectedSelection(state, options)) return state;
      const next = combine(state);
      notice =
        next === state || options.keepOperands === true
          ? ''
          : removedTabsNotice(
              selectedVectorObjects(state.project.scene, selectedObjectIds(state)),
              what,
            );
      return next;
    },
    () => {
      if (notice !== '') useToastStore.getState().pushToast(notice, 'info');
    },
    options.isCurrent,
  );
}

function hasPlacedTabs(object: SceneObject): boolean {
  return (object.laserTabAnchors?.length ?? 0) > 0 || (object.cncTabAnchors?.length ?? 0) > 0;
}
