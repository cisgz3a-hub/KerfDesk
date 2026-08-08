import {
  runCncCompilationTask,
  type CncCompilationRegionResult,
  type CncCompilationTaskPayload,
} from '../../core/cnc/cnc-compilation-artifact';
import type {
  BoundedCompilationWorkerRequest,
  BoundedCompilationWorkerResponse,
} from './bounded-compilation-worker-pool';
import type { BoundedCompilationBridgePort } from './bounded-compilation-bridge-protocol';
import type { DeviceProfile } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import {
  depthMapToHeightmap,
  type DepthMapHeightmapOptions,
  type DepthMapHeightmapResult,
} from '../../core/relief/depth-map-to-heightmap';
import type { CncMachineConfig, ReliefObject } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import { prepareCncCut3DSurface } from './cnc-cut3d-surface';
import { computeCncRemovalGrid } from './cnc-removal-grid';

type ReliefDepthMap = NonNullable<ReliefObject['depthMap']>;

export const CANVAS_COMPILATION_BRIDGE_CONNECTION = 'canvas-compilation-bridge-v1';

export type CanvasCompilationTaskPayload =
  | {
      readonly kind: 'cnc-vcarve-region';
      readonly input: CncCompilationTaskPayload;
    }
  | {
      readonly kind: 'cnc-removal-grid';
      readonly device: DeviceProfile;
      readonly machine: CncMachineConfig;
      readonly toolpath: Toolpath;
      readonly scrubFraction: number;
    }
  | {
      readonly kind: 'cnc-cut3d-surface';
      readonly grid: RemovalGrid;
    }
  | {
      readonly kind: 'relief-heightmap';
      readonly source: ReliefDepthMap;
      readonly options: DepthMapHeightmapOptions;
    };

export type CanvasCompilationTaskResult =
  | {
      readonly kind: 'cnc-vcarve-region';
      readonly output: CncCompilationRegionResult;
    }
  | { readonly kind: 'cnc-removal-grid'; readonly output: RemovalGrid | null }
  | { readonly kind: 'cnc-cut3d-surface'; readonly output: ReliefSurfaceMeshWithNormals }
  | { readonly kind: 'relief-heightmap'; readonly output: DepthMapHeightmapResult };

/** Ownership transfers for clone-safe task results that carry large typed arrays. */
export function canvasCompilationResultTransferables(
  result: CanvasCompilationTaskResult,
): Transferable[] {
  if (result.kind === 'cnc-removal-grid') {
    return result.output === null ? [] : [result.output.depth.buffer];
  }
  if (result.kind === 'cnc-cut3d-surface') {
    return [
      result.output.positions.buffer,
      result.output.indices.buffer,
      result.output.normals.buffer,
    ];
  }
  if (result.kind === 'relief-heightmap' && result.output.kind === 'ok') {
    return [result.output.heightmap.depth.buffer];
  }
  return [];
}

export type CanvasCompilationWorkerRequest =
  BoundedCompilationWorkerRequest<CanvasCompilationTaskPayload>;
export type CanvasCompilationWorkerResponse =
  BoundedCompilationWorkerResponse<CanvasCompilationTaskResult>;

export type CanvasCompilationBridgeConnection = {
  readonly kind: typeof CANVAS_COMPILATION_BRIDGE_CONNECTION;
  readonly port: BoundedCompilationBridgePort;
};

export function isCanvasCompilationBridgeConnection(
  value: unknown,
): value is CanvasCompilationBridgeConnection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== CANVAS_COMPILATION_BRIDGE_CONNECTION) return false;
  if (typeof candidate.port !== 'object' || candidate.port === null) return false;
  const port = candidate.port as Record<string, unknown>;
  return typeof port.postMessage === 'function';
}

/** Exhaustive operation registry shared by real workers and sequential fallback. */
export function executeCanvasCompilationTask(
  task: CanvasCompilationTaskPayload,
): CanvasCompilationTaskResult {
  switch (task.kind) {
    case 'cnc-vcarve-region':
      return { kind: task.kind, output: runCncCompilationTask(task.input) };
    case 'cnc-removal-grid':
      return {
        kind: task.kind,
        output: computeCncRemovalGrid(task.device, task.machine, task.toolpath, task.scrubFraction),
      };
    case 'cnc-cut3d-surface':
      return { kind: task.kind, output: prepareCncCut3DSurface(task.grid) };
    case 'relief-heightmap':
      return { kind: task.kind, output: depthMapToHeightmap(task.source, task.options) };
  }
}
