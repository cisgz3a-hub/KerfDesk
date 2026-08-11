import type { DeviceProfile } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
// Deep import: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type {
  HeightfieldHeightmapOptions,
  HeightfieldHeightmapResult,
} from '../../core/relief/heightfield-to-heightmap';
import type { CncMachineConfig } from '../../core/scene';
import type { ReliefHeightfield } from '../../core/scene/relief';
import type { RemovalGrid } from '../../core/sim';

/** One independently bound heightfield materialization request inside a worker batch. */
export type ReliefHeightmapWorkerItem = {
  readonly taskId: string;
  readonly source: ReliefHeightfield;
  readonly options: HeightfieldHeightmapOptions;
};

/** Bound heightfield materialization result returned for one batch item. */
export type ReliefHeightmapWorkerResult = {
  readonly taskId: string;
  readonly result: HeightfieldHeightmapResult;
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

/** Transfer every owned typed-array buffer in an outer-worker response. */
export function cncPreviewResponseTransferables(
  response: CncRemovalGridWorkerResponse,
): Transferable[] {
  if (response.kind === 'grid') {
    return response.grid === null ? [] : heightmapTransferables(response.grid);
  }
  if (response.kind === 'surface') {
    return [
      response.surface.positions.buffer,
      response.surface.indices.buffer,
      response.surface.normals.buffer,
    ];
  }
  if (response.kind === 'relief-heightmaps') {
    return response.items.flatMap((item) =>
      item.result.kind === 'ok' ? heightmapTransferables(item.result.heightmap) : [],
    );
  }
  return [];
}

function heightmapTransferables(map: {
  readonly depth: Float32Array;
  readonly inclusion?: Uint8Array;
}): Transferable[] {
  return [map.depth.buffer, ...(map.inclusion === undefined ? [] : [map.inclusion.buffer])];
}
