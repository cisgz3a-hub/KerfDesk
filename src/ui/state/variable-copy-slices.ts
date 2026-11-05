// Time slices for rendering variable copies on the UI thread (performance audit S7-P2-1,
// ADR-307 Amendment 4). A record's render settles in microtasks, so a batch of copies ran
// as one task: the window froze and Cancel waited for the last copy. The loop now gives
// the event loop a turn once each slice is spent, so no block runs much past one slice and
// one record, and a Cancel click is handled at the next turn.

/** How long copies render before the event loop gets a turn. */
export const VARIABLE_COPY_SLICE_MS = 50;

/**
 * A yield for prepareVariableArray: it resolves at once while the slice lasts, and after a
 * macrotask once the slice is spent, which starts the next slice.
 */
export function variableCopySlices(
  now: () => number = () => performance.now(),
  sliceMs = VARIABLE_COPY_SLICE_MS,
  nextTask: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): () => Promise<void> {
  let sliceStart = now();
  return async () => {
    if (now() - sliceStart < sliceMs) return;
    await nextTask();
    sliceStart = now();
  };
}
