import { combinedBBox } from '../../core/scene/hit-test';
import type { AppState } from '../state/store';
import type { RemoteBounds } from './types';
import { RemoteFault } from './fault';
import { remoteBounds } from './projections';
import { artworkGroupExpander, editableArtwork } from './transforms';

const MIN_RESIZE_DIMENSION_MM = 0.000001;

/** Effective dimensions only for complete editable targets in the bounded public snapshot. */
export function artworkTransformBounds(
  state: AppState,
  artwork: readonly { readonly id: string }[],
): ReadonlyMap<string, RemoteBounds | undefined> {
  const published = new Set(artwork.map((item) => item.id));
  const expand = artworkGroupExpander(state);
  const result = new Map<string, RemoteBounds | undefined>();
  for (const item of artwork) {
    if (result.has(item.id)) continue;
    let ids = [item.id];
    let bounds: RemoteBounds | undefined;
    try {
      ids = expand(ids);
      if (ids.every((id) => published.has(id))) {
        const box = combinedBBox(editableArtwork(state, ids));
        if (box !== null) bounds = remoteBounds(box);
        if (
          bounds !== undefined &&
          (bounds.widthMm <= MIN_RESIZE_DIMENSION_MM || bounds.heightMm <= MIN_RESIZE_DIMENSION_MM)
        )
          bounds = undefined;
      }
    } catch (error) {
      if (!(error instanceof RemoteFault)) throw error;
    }
    for (const id of ids) result.set(id, bounds);
  }
  return result;
}
