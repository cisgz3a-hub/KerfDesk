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
// Deep import: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import {
  heightfieldToHeightmap,
  type HeightfieldHeightmapOptions,
  type HeightfieldHeightmapResult,
} from '../../core/relief/heightfield-to-heightmap';
import type { CncMachineConfig, Vec2 } from '../../core/scene';
import type { ReliefHeightfield } from '../../core/scene/relief';
import type { RemovalGrid } from '../../core/sim';
import { prepareCncCut3DSurface } from './cnc-cut3d-surface';
import { computeCncRemovalGrid } from './cnc-removal-grid';

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
      readonly jobOriginOffset: Vec2;
    }
  | {
      readonly kind: 'cnc-cut3d-surface';
      readonly grid: RemovalGrid;
    }
  | {
      readonly kind: 'relief-heightmap';
      readonly source: ReliefHeightfield;
      readonly options: HeightfieldHeightmapOptions;
    };

export type CanvasCompilationTaskResult =
  | {
      readonly kind: 'cnc-vcarve-region';
      readonly output: CncCompilationRegionResult;
    }
  | { readonly kind: 'cnc-removal-grid'; readonly output: RemovalGrid | null }
  | { readonly kind: 'cnc-cut3d-surface'; readonly output: ReliefSurfaceMeshWithNormals }
  | { readonly kind: 'relief-heightmap'; readonly output: HeightfieldHeightmapResult };

/** Ownership transfers for clone-safe task results that carry large typed arrays. */
export function canvasCompilationResultTransferables(
  result: CanvasCompilationTaskResult,
): Transferable[] {
  if (result.kind === 'cnc-removal-grid') {
    return result.output === null
      ? []
      : [
          result.output.depth.buffer,
          ...(result.output.inclusion === undefined ? [] : [result.output.inclusion.buffer]),
        ];
  }
  if (result.kind === 'cnc-cut3d-surface') {
    return [
      result.output.positions.buffer,
      result.output.indices.buffer,
      result.output.normals.buffer,
    ];
  }
  if (result.kind === 'relief-heightmap' && result.output.kind === 'ok') {
    const { heightmap } = result.output;
    return [
      heightmap.depth.buffer,
      ...(heightmap.inclusion === undefined ? [] : [heightmap.inclusion.buffer]),
    ];
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
        output: computeCncRemovalGrid(
          task.device,
          task.machine,
          task.toolpath,
          task.scrubFraction,
          task.jobOriginOffset,
        ),
      };
    case 'cnc-cut3d-surface':
      return { kind: task.kind, output: prepareCncCut3DSurface(task.grid) };
    case 'relief-heightmap':
      return { kind: task.kind, output: heightfieldToHeightmap(task.source, task.options) };
  }
}
