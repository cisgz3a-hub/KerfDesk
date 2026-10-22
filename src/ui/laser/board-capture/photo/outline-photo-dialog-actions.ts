import { loadImageAsRawData } from '../../../trace/image-loader';
import { displayPointToImage, nearestOutlineVertex } from './outline-photo-logic';
import type { OutlinePhotoDispatch, OutlinePhotoSession } from './use-outline-photo-session';

// Pressing this close to an existing point (screen px) picks it up to drag.
const GRAB_RADIUS_PX = 12;

// Initial file, picker and paste share the reducer dispatch for one dialog.
// A newer selection owns both success and failure; a late decode must never
// replace its photo, outline or error. Weak keys keep separate dialogs isolated.
const photoRequests = new WeakMap<OutlinePhotoDispatch, object>();

export async function loadOutlinePhoto(
  file: File | undefined,
  dispatch: OutlinePhotoDispatch,
): Promise<void> {
  if (file === undefined) return;
  const request = {};
  photoRequests.set(dispatch, request);
  try {
    const image = await loadImageAsRawData(file, 2048);
    if (photoRequests.get(dispatch) === request) dispatch({ type: 'photo-loaded', image });
  } catch (error) {
    if (photoRequests.get(dispatch) !== request) return;
    dispatch({
      type: 'error',
      error: error instanceof Error ? error.message : 'Could not load that photo.',
    });
  } finally {
    if (photoRequests.get(dispatch) === request) photoRequests.delete(dispatch);
  }
}

/** The first image on the clipboard of a paste event, as a file. */
export function pastedImageFile(event: ClipboardEvent): File | undefined {
  const items = [...(event.clipboardData?.items ?? [])];
  const item = items.find((candidate) => candidate.type.startsWith('image/'));
  return item?.getAsFile() ?? undefined;
}

/**
 * Pressing the photo either grabs the nearest point to drag it, or adds a new
 * point at the end of the outline. With Straighten edge on, it picks the
 * nearest point as an end of the edge instead. Returns the index being dragged.
 */
export function pressOutlinePhoto(
  event: React.PointerEvent<HTMLCanvasElement>,
  state: OutlinePhotoSession,
  dispatch: OutlinePhotoDispatch,
): number | null {
  if (state.image === null) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  const image = state.image;
  const onScreen = state.points.map((point) => ({
    x: (point.x * rect.width) / image.width,
    y: (point.y * rect.height) / image.height,
  }));
  const nearest = nearestOutlineVertex(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    onScreen,
    GRAB_RADIUS_PX,
  );
  if (state.straighten !== null) {
    if (nearest !== null) dispatch({ type: 'straighten-point-picked', index: nearest });
    return null;
  }
  if (nearest !== null) {
    dispatch({ type: 'drag-started' });
    return nearest;
  }
  dispatch({ type: 'point-added', point: photoPoint(event, rect, state) });
  return null;
}

export function dragOutlinePoint(
  event: React.PointerEvent<HTMLCanvasElement>,
  index: number,
  state: OutlinePhotoSession,
  dispatch: OutlinePhotoDispatch,
): void {
  if (state.image === null) return;
  const rect = event.currentTarget.getBoundingClientRect();
  dispatch({ type: 'point-moved', index, point: photoPoint(event, rect, state) });
}

function photoPoint(
  event: React.PointerEvent<HTMLCanvasElement>,
  rect: DOMRect,
  state: OutlinePhotoSession,
): { readonly x: number; readonly y: number } {
  const image = state.image ?? { width: rect.width, height: rect.height };
  const point = displayPointToImage({ x: event.clientX, y: event.clientY }, rect, image);
  return {
    x: Math.min(image.width, Math.max(0, point.x)),
    y: Math.min(image.height, Math.max(0, point.y)),
  };
}
