// useSourceTrackedState — local state that prefills from a store value and
// keeps following it until the operator types their own, then re-follows when
// the SOURCE changes underneath.
//
// The audited failure this removes: a control seeded with
// `useState(storeValue)` freezes at mount. Change the stock footprint, the
// active bit, or the layer's material recipe from another surface and the box
// still shows — and acts on — the value from when it first rendered. The
// surfacing panel wrote G-code for a stale area that way.
//
// Generalized from useFluteSelection in FeedsCalculatorRow, which already
// solved exactly this for one field.

import { useState } from 'react';

/**
 * @param source the live value to follow (read from the store every render).
 * @param contextKey identity of what `source` describes. An override survives
 *   while this is stable and is dropped the moment it changes, so a new bit /
 *   stock / recipe re-prefills instead of silently keeping the old number.
 */
export function useSourceTrackedState<T>(
  source: T,
  contextKey: string,
): readonly [T, (next: T) => void] {
  const [override, setOverride] = useState<{ readonly key: string; readonly value: T } | null>(
    null,
  );
  const value = override !== null && override.key === contextKey ? override.value : source;
  return [value, (next: T) => setOverride({ key: contextKey, value: next })];
}
