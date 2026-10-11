import type {
  ProductionNestingInput,
  ProductionNestingProgress,
} from '../../core/nesting/production-nest';
import type { NestingInput, NestingProgress } from '../../core/nesting/layout-nest';

export type NestingWorkerRequest =
  | { readonly kind: 'search'; readonly input: NestingInput }
  | {
      readonly kind: 'production-search';
      readonly input: ProductionNestingInput;
      readonly advanced?: boolean;
    }
  | { readonly kind: 'advanced-result'; readonly certificate: string }
  | { readonly kind: 'advanced-finished'; readonly notice?: string };
export type NestingWorkerResponse =
  | { readonly kind: 'progress'; readonly progress: NestingProgress }
  | { readonly kind: 'complete' }
  | { readonly kind: 'production-progress'; readonly progress: ProductionNestingProgress }
  | { readonly kind: 'production-complete' }
  | { readonly kind: 'advanced-start'; readonly instance: string }
  | { readonly kind: 'error'; readonly message: string };
