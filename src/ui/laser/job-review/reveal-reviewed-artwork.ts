import { sceneObjectHasVisibleLayer } from '../../../core/scene';
import { scopedSelectionProjectPatch } from '../../state/project-job-setup';
import { useStore } from '../../state/store';
import { useUiStore } from '../../state/ui-store';
import { useJobReviewStore } from './job-review-store';
import { matchingReviewArtworkIds, type ReviewArtworkSource } from './review-artwork-sources';

/** Advisory navigation shared by reviewed omissions. It grants no run permit,
 * and never expands the reviewed IDs to unrelated members of a canvas group. */
export function revealReviewedArtwork(
  sources: ReadonlyArray<ReviewArtworkSource>,
  eligibleIds: ReadonlySet<string>,
): boolean {
  const request = useJobReviewStore.getState();
  const review = request.state;
  if (
    review.kind !== 'open' ||
    review.purpose === 'laser-second-pass' ||
    review.isPreparing ||
    review.blocker !== null
  )
    return false;
  const app = useStore.getState();
  // Identical artwork can belong to a newly switched or duplicated sheet.
  // Rebuilding the model must not retarget the original review request.
  if (request.requestDocumentEpoch !== app.projectDocumentEpoch) return false;
  const matching = new Set(matchingReviewArtworkIds(sources, app.project.scene.objects));
  const ids = app.project.scene.objects
    .filter(
      (object) =>
        matching.has(object.id) &&
        eligibleIds.has(object.id) &&
        object.locked !== true &&
        sceneObjectHasVisibleLayer(app.project.scene, object),
    )
    .map((object) => object.id);
  if (ids.length === 0) return false;

  // Resolve the run's waiter before selection can request a review rebuild.
  useJobReviewStore.getState().cancelAndClose();
  useStore.setState((state) => ({
    ...scopedSelectionProjectPatch(state, {
      selectedObjectId: ids[0] ?? null,
      additionalSelectedIds: new Set(ids.slice(1)),
    }),
    selectedPathNode: null,
    selectedPathNodes: [],
  }));
  useStore.getState().fitToSelection();
  const ui = useUiStore.getState();
  ui.setCutsLayersView('layers');
  ui.focusRailPanel('layers');
  return true;
}
