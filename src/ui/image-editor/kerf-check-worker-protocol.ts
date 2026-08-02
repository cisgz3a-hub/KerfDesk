import type { KerfOutputParity, KerfOutputParityInput } from './editor-kerf-output-parity';

/** Structured-clone-safe analysis payload for one target-scoped kerf check. */
export type KerfCheckWorkerPayload = KerfOutputParityInput;

/**
 * One request on the shared kerf parity worker. The id routes the response back
 * to the caller that owns it; a response whose id the client no longer tracks
 * belongs to a cancelled or superseded check and is dropped.
 */
export type KerfCheckWorkerRequest = KerfCheckWorkerPayload & {
  readonly id: number;
};

/** Terminal result from one target-scoped kerf parity computation. */
export type KerfCheckWorkerResponse =
  | { readonly kind: 'ok'; readonly id: number; readonly parity: KerfOutputParity | null }
  | { readonly kind: 'error'; readonly id: number; readonly message: string };
