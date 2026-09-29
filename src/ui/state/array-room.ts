// Array and the project's object limit (ADR-307 amendment 1): whether a request
// for so many instances fits in the room a project has left, and what to tell
// the person when it does not. The Array dialog's status line, the store action
// and the variable-copy preparation all ask here, so they give the same answer.

import { arrayPlacementCount } from '../../core/scene/array-layout';
import type { ArraySpec } from '../../core/scene/array-layout-types';
import { noRoomMessage, roomHolds } from './scene-copy-room';

const SUBJECT = 'selection';

/** What to change to ask for fewer: the wording follows the controls the person used. */
export const FEWER_COPIES = 'Use fewer copies.';
export const FEWER_PIECES = 'Untick some pieces.';
const FEWER_ROWS_OR_COLUMNS = 'Use fewer rows or columns.';

export function arrayAsk(spec: ArraySpec): string {
  return spec.kind === 'grid' ? FEWER_ROWS_OR_COLUMNS : FEWER_COPIES;
}

/**
 * What an array copies: the selection, less the object a circular array is
 * centred on, which stays where it is (LightBurn gap LBG-T14).
 */
export function arrayCopiedIds(
  selectedIds: ReadonlySet<string>,
  centreObjectId: string | undefined,
): ReadonlySet<string> {
  if (centreObjectId === undefined || !selectedIds.has(centreObjectId)) return selectedIds;
  return new Set([...selectedIds].filter((id) => id !== centreObjectId));
}

/**
 * Why `instances` (the original included) do not fit in `room` more copies, or
 * null when they do. The original moves to the first placement, so it is not a
 * copy: an array of one instance always fits.
 */
export function arrayRoomProblem(room: number, instances: number, ask: string): string | null {
  if (instances - 1 <= room) return null;
  return room < 1 ? noRoomMessage(SUBJECT) : `${roomHolds(room, SUBJECT)}. ${ask}`;
}

/** The same, for the instances a request makes, counted without laying any out. */
export function arraySpecRoomProblem(room: number, spec: ArraySpec): string | null {
  return arrayRoomProblem(room, arrayPlacementCount(spec), arrayAsk(spec));
}
