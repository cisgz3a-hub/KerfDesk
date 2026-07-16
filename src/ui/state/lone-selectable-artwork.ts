// Single-artwork default selection (ADR-222): a scene whose ONLY artwork is
// selectable keeps that artwork marked (selected), so the Selected-artwork
// inspector and its operation settings never blank out in the common
// one-design workflow.
//
// "Artwork" excludes the registration jig / captured-board outline — those are
// placement aids (ADR-057 / ADR-124), so they neither count toward "only one
// artwork" nor get auto-selected. A locked or hidden lone artwork returns
// null: Lock Selection and layer-hide deliberately clear the selection, and
// re-marking would fight those flows.

import { isRegistrationBox, sceneObjectHasVisibleLayer, type Scene } from '../../core/scene';

/**
 * The id of the scene's only artwork when it is selectable (unlocked, on a
 * visible layer), or null when the scene has zero or 2+ artworks — the states
 * where an empty selection is legitimate (ADR-222).
 */
export function loneSelectableArtworkId(scene: Scene): string | null {
  const artwork = scene.objects.filter((object) => !isRegistrationBox(object));
  const only = artwork.length === 1 ? artwork[0] : undefined;
  if (only === undefined || only.locked === true) return null;
  return sceneObjectHasVisibleLayer(scene, only) ? only.id : null;
}
