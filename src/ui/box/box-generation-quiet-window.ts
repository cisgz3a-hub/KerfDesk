// Coalescing policy for box preview generation.
//
// Every distinct spec is generated in the box worker. Typing "120" into a width
// field emits three specs, and the generator runs synchronously inside the
// worker: three requests posted back to back run to completion one after
// another, so the preview for the value the operator actually typed lands only
// after two dead generations have finished ahead of it.
//
// A request that supersedes live work therefore waits out a short quiet window,
// re-armed by each further edit, so a typing burst costs one generation instead
// of one per keystroke. A request that supersedes nothing dispatches
// immediately — the first preview of a session, and any edit made after the
// previous one settled, are never delayed. Same shape as the workspace prepare
// client's SUPERSEDE_QUIET_WINDOW_MS hold-back.

// 200 ms sits above a fast typist's inter-keystroke gap (~120 ms) so a burst
// collapses, and below the ~250 ms mark where a settled field stops feeling
// like it responded immediately.
export const BOX_GENERATION_QUIET_WINDOW_MS = 200;

export type BoxGenerationDispatchInput = {
  // The operator pressed Retry. Operator-initiated work is never held back.
  readonly isRetry: boolean;
  // Starting this request cancelled an in-flight or still-held request.
  readonly hasSupersededLiveWork: boolean;
};

export function isImmediateDispatch(input: BoxGenerationDispatchInput): boolean {
  return input.isRetry || !input.hasSupersededLiveWork;
}
