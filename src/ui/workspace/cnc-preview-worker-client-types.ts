import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import type {
  CncRemovalGridWorkerRequest,
  ReliefHeightmapWorkerResult,
} from './cnc-removal-grid-worker-protocol';

export type MainRequest = Extract<
  CncRemovalGridWorkerRequest,
  { readonly kind: 'grid' | 'surface' }
>;

type MainCancellation = {
  readonly signal?: AbortSignal;
  abortListener?: () => void;
};

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

export type ReliefPending = {
  readonly id: number;
  readonly request: Extract<CncRemovalGridWorkerRequest, { readonly kind: 'relief-heightmaps' }>;
  readonly resolve: (items: ReadonlyArray<ReliefHeightmapWorkerResult>) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  abortListener?: () => void;
};

export class CncRemovalGridSupersededError extends Error {
  override readonly name = 'CncRemovalGridSupersededError';

  constructor() {
    super('CNC preview preparation superseded');
  }
}

export function isCncRemovalGridSuperseded(error: unknown): boolean {
  return error instanceof CncRemovalGridSupersededError;
}
