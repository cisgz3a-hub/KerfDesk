// watchedFieldsEqual — equality for a WHOLE-state zustand subscription that
// must only re-render when specific fields change.
//
// Some always-mounted consumers hand the entire store state to helpers typed
// against `ReturnType<typeof useStore.getState>`, so they cannot select a
// narrow object without rewriting every helper signature. Pairing
// `selectWholeState` with this equality keeps the full state object while
// taking the consumer off the hot write paths it never reads — setCursorMm at
// mousemove cadence, the 250 ms status-report poll, and the per-ack streamer
// replacement during a burn.
//
// zustand returns the PREVIOUS state object while every watched field compares
// equal, so an unlisted field may be stale. List every field the consumer reads
// while rendering, and read anything else through `getState()` inside the
// action closure that needs it, where it is exact by construction.

/** Identity selector for a whole-state subscription. Module-level so the
 *  selector reference stays stable across renders. */
export function selectWholeState<S>(state: S): S {
  return state;
}

export function watchedFieldsEqual<S, K extends keyof S>(
  fields: ReadonlyArray<K>,
): (a: S, b: S) => boolean {
  return (a, b) => a === b || fields.every((field) => Object.is(a[field], b[field]));
}
