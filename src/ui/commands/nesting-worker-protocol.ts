import type { NestingInput, NestingProgress } from '../../core/nesting/layout-nest';

export type NestingWorkerRequest = { readonly kind: 'search'; readonly input: NestingInput };
export type NestingWorkerResponse =
  | { readonly kind: 'progress'; readonly progress: NestingProgress }
  | { readonly kind: 'complete' }
  | { readonly kind: 'error'; readonly message: string };
