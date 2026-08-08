import type { DeviceProfile } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type {
  DepthMapHeightmapOptions,
  DepthMapHeightmapResult,
} from '../../core/relief/depth-map-to-heightmap';
import type { CncMachineConfig } from '../../core/scene';
import type { ReliefDepthMap } from '../../core/scene/relief';
import type { RemovalGrid } from '../../core/sim';

/** One independently bound depth-map materialization request inside a worker batch. */
export type ReliefHeightmapWorkerItem = {
  readonly taskId: string;
  readonly source: ReliefDepthMap;
  readonly options: DepthMapHeightmapOptions;
};

/** Bound depth-map materialization result returned for one batch item. */
export type ReliefHeightmapWorkerResult = {
  readonly taskId: string;
  readonly result: DepthMapHeightmapResult;
};

export type CncRemovalGridWorkerRequest =
  | {
      /** Existing relief request id to abort; cancellation does not allocate a new id. */
      readonly id: number;
      readonly kind: 'cancel-relief';
    }
  | {
      readonly id: number;
      readonly kind: 'grid';
      readonly device: DeviceProfile;
      readonly machine: CncMachineConfig;
      readonly toolpath: Toolpath;
      readonly scrubFraction: number;
    }
  | {
      readonly id: number;
      readonly kind: 'surface';
      readonly grid: RemovalGrid;
    }
  | {
      readonly id: number;
      readonly kind: 'relief-heightmaps';
      readonly items: ReadonlyArray<ReliefHeightmapWorkerItem>;
    };

export type CncRemovalGridWorkerResponse =
  | { readonly id: number; readonly kind: 'grid'; readonly grid: RemovalGrid | null }
  | {
      readonly id: number;
      readonly kind: 'surface';
      readonly surface: ReliefSurfaceMeshWithNormals;
    }
  | {
      readonly id: number;
      readonly kind: 'relief-heightmaps';
      readonly items: ReadonlyArray<ReliefHeightmapWorkerResult>;
    }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
