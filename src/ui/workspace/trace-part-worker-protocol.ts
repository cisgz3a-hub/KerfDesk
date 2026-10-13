import type { PartGroups, TracePartGroupMode } from '../../core/trace/trace-part-groups';
import type { PackedColoredPath } from '../packed-project-transfer';

export type TracePartWorkerRequest = {
  readonly id: number;
  readonly path: PackedColoredPath;
  readonly mode: TracePartGroupMode | null;
};

export type TracePartWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'ok';
      readonly bounds: Float64Array;
      readonly groups: PartGroups | null;
    }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
