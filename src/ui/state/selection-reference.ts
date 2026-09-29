// Align's reference object. LightBurn aligns to the last object added to the
// selection, but the selection ids are kept in stacking order, so the order
// the operator clicked in is lost there. This records the object last clicked
// into the selection (a plain click, or a Shift+click that adds it) together
// with the exact selection that click produced.
//
// The record counts only while that selection is still the current one. Every
// other way of changing the selection (a marquee, Select All, paste, delete, a
// command that selects its result) builds a new selection, so the record lapses
// and Align falls back to its stacking-order rule without each of those writers
// having to know about it: a stale record can never pick the reference. The few
// actions that keep the clicked object selected on purpose (Shift+click
// removing another object, undo and redo, a cancelled drag, group and ungroup)
// carry the record over to the selection they make.
//
// The record joins the store through SelectionTransformActions, next to the
// Align action that reads it.

import type { AppState } from './store';

export type SelectionReference = {
  readonly id: string;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

/** Absent or null until an object is clicked into the selection. */
export type SelectionReferenceState = {
  readonly selectionReference?: SelectionReference | null;
};

type Selection = Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>;
type SelectionWithReference = Selection & SelectionReferenceState;

/** The record for `id` clicked into `selection`, or null when the click left it unselected. */
export function clickedSelectionReference(
  id: string,
  selection: Selection,
): SelectionReference | null {
  if (!isSelected(selection, id)) return null;
  return {
    id,
    selectedObjectId: selection.selectedObjectId,
    additionalSelectedIds: selection.additionalSelectedIds,
  };
}

/** Shift+click: the object when it was added, else the earlier record while its object stays. */
export function toggledSelectionReference(
  state: SelectionWithReference,
  id: string,
  next: Selection,
): SelectionReference | null {
  return isSelected(next, id)
    ? clickedSelectionReference(id, next)
    : carriedSelectionReference(state, next);
}

/** Moves the record to `next`, the selection an action is about to set, if its object stays in it. */
export function carriedSelectionReference(
  state: SelectionWithReference,
  next: Selection,
): SelectionReference | null {
  const id = selectionReferenceId(state);
  return id === null ? null : clickedSelectionReference(id, next);
}

/** The object last clicked into the current selection, or null when it was made another way. */
export function selectionReferenceId(state: SelectionWithReference): string | null {
  const reference = state.selectionReference;
  if (reference === undefined || reference === null) return null;
  const current =
    reference.selectedObjectId === state.selectedObjectId &&
    reference.additionalSelectedIds === state.additionalSelectedIds;
  return current && isSelected(state, reference.id) ? reference.id : null;
}

function isSelected(selection: Selection, id: string): boolean {
  return selection.selectedObjectId === id || selection.additionalSelectedIds.has(id);
}
