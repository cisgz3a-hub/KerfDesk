import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import type {
  CncRemovalGridWorkerRequest,
  ReliefHeightmapWorkerResult,
} from './cnc-removal-grid-worker-protocol';

/** Latest-only removal-grid or Cut 3D request accepted by the shared preview worker. */
export type MainRequest = Extract<
  CncRemovalGridWorkerRequest,
  { readonly kind: 'grid' | 'surface' }
>;

type MainCancellation = {
  readonly signal?: AbortSignal;
  readonly abortListener?: () => void;
};

/** Resolver and cancellation ownership for the current latest-only preview request. */
export type MainPending = (
  | {
      readonly id: number;
      readonly kind: 'grid';
      readonly resolve: (grid: RemovalGrid | null) => void;
      readonly reject: (error: Error) => void;
    }
  | {
      readonly id: number;
      readonly kind: 'surface';
      readonly resolve: (surface: ReliefSurfaceMeshWithNormals) => void;
      readonly reject: (error: Error) => void;
    }
) &
  MainCancellation;

/** Resolver, request payload, and cancellation ownership for one queued relief batch. */
export type ReliefPending = {
  readonly id: number;
  readonly request: Extract<CncRemovalGridWorkerRequest, { readonly kind: 'relief-heightmaps' }>;
  readonly resolve: (items: ReadonlyArray<ReliefHeightmapWorkerResult>) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly abortListener?: () => void;
};

/** Error used when newer latest-only preview work replaces an older request. */
export class CncRemovalGridSupersededError extends Error {
  override readonly name = 'CncRemovalGridSupersededError';

  constructor() {
    super('CNC preview preparation superseded');
  }
}

/** Return whether a preview rejection means newer latest-only work replaced it. */
export function isCncRemovalGridSuperseded(error: unknown): boolean {
  return error instanceof CncRemovalGridSupersededError;
}
