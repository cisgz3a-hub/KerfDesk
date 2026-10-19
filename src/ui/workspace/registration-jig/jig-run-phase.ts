import {
  findRegistrationBoxes,
  findRegistrationLayer,
  registrationOutputConflict,
  type Scene,
} from '../../../core/scene';

/** Which run Frame and Start burn next. The outlines count as burned once
 *  their operation stops outputting (Artwork only), even before any artwork
 *  exists; 'both' is the one-pass mix the two-run jig must avoid. */
export type JigRunPhase = 'none' | 'outlines' | 'artwork' | 'both';

export function jigRunPhase(scene: Scene): JigRunPhase {
  const layer = findRegistrationLayer(scene);
  if (layer === null || findRegistrationBoxes(scene).length === 0) return 'none';
  if (!layer.output) return 'artwork';
  return registrationOutputConflict(scene) ? 'both' : 'outlines';
}
