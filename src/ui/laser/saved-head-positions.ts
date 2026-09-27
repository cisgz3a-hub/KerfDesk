// Saved head positions list edits (ADR-493). Names are the key: saving under a
// name that exists replaces that entry in place, so "Corner stop" can be
// re-taught without a duplicate. A blank name gets the next "Position N".

import type { SavedHeadPosition } from '../../core/devices/device-profile';

export function savedPositionsAfterSave(
  saved: ReadonlyArray<SavedHeadPosition>,
  requestedName: string,
  draft: Omit<SavedHeadPosition, 'name'>,
): ReadonlyArray<SavedHeadPosition> {
  const name = requestedName.trim() === '' ? defaultSavedPositionName(saved) : requestedName.trim();
  const entry: SavedHeadPosition = { name, ...draft };
  const index = saved.findIndex((position) => position.name === name);
  if (index === -1) return [...saved, entry];
  return saved.map((position, at) => (at === index ? entry : position));
}

export function savedPositionsAfterDelete(
  saved: ReadonlyArray<SavedHeadPosition>,
  name: string,
): ReadonlyArray<SavedHeadPosition> {
  return saved.filter((position) => position.name !== name);
}

export function defaultSavedPositionName(saved: ReadonlyArray<SavedHeadPosition>): string {
  const names = new Set(saved.map((position) => position.name));
  let index = saved.length + 1;
  while (names.has(`Position ${index}`)) index += 1;
  return `Position ${index}`;
}
