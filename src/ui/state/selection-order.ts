// selection-order — the order the operator picked the selected objects in
// (ADR-377). The selection itself (selectedObjectId + additionalSelectedIds)
// stays in stacking order, which drives drawing, hit testing and output order;
// this record only answers "which was picked first" for Align's reference (the
// last pick) and Boolean Subtract's kept shape (the first pick), as LightBurn
// does (https://docs.lightburnsoftware.com/2.1/Reference/BooleanTools/).
//
// Only the picking actions (click, Shift-click, marquee, Select All, select by
// operation) write the record. Every other action that changes the selection
// leaves it alone, and orderedSelectionIds reconciles on read: picks that are
// still selected keep their order and anything else selected follows in
// stacking order.

import type { AppState } from './store';

type SelectionIds = Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>;
type SelectionWithOrder = SelectionIds & Pick<AppState, 'selectionOrder'>;

/** Selected ids in pick order. A group's members sit together in stacking order. */
export function orderedSelectionIds(state: SelectionWithOrder): ReadonlyArray<string> {
  const selected = stackingSelectionIds(state);
  const selectedSet = new Set(selected);
  const picked = [...new Set(state.selectionOrder ?? [])].filter((id) => selectedSet.has(id));
  const pickedSet = new Set(picked);
  return [...picked, ...selected.filter((id) => !pickedSet.has(id))];
}

/** The record for a selection picked from scratch: stacking order. */
export function freshSelectionOrder(next: SelectionIds): ReadonlyArray<string> {
  return stackingSelectionIds(next);
}

/** The record after adding to or removing from the selection: earlier picks
 * that stay selected keep their order, and new ids join at the end. */
export function extendedSelectionOrder(
  previous: SelectionWithOrder,
  next: SelectionIds,
): ReadonlyArray<string> {
  const nextIds = stackingSelectionIds(next);
  const nextSet = new Set(nextIds);
  const kept = orderedSelectionIds(previous).filter((id) => nextSet.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...nextIds.filter((id) => !keptSet.has(id))];
}

/** `objects` sorted into pick order (a stable sort, unselected ones last). */
export function inSelectionOrder<T extends { readonly id: string }>(
  state: SelectionWithOrder,
  objects: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const rank = new Map(orderedSelectionIds(state).map((id, index) => [id, index]));
  const rankOf = (object: T): number => rank.get(object.id) ?? rank.size;
  return [...objects].sort((left, right) => rankOf(left) - rankOf(right));
}

function stackingSelectionIds(state: SelectionIds): ReadonlyArray<string> {
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
}
