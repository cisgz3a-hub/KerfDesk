import type { KerfOutputParity, KerfOutputParityInput } from './editor-kerf-output-parity';

/** Structured-clone-safe request consumed by one kerf parity worker. */
export type KerfCheckWorkerRequest = KerfOutputParityInput;

/** Terminal result from one target-scoped kerf parity computation. */
export type KerfCheckWorkerResponse =
  | { readonly kind: 'ok'; readonly parity: KerfOutputParity | null }
  | { readonly kind: 'error'; readonly message: string };
