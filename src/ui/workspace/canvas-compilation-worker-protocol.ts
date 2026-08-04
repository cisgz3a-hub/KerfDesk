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
import type { CncMachineConfig } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
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
    };

export type CanvasCompilationTaskResult =
  | {
      readonly kind: 'cnc-vcarve-region';
      readonly output: CncCompilationRegionResult;
    }
  | { readonly kind: 'cnc-removal-grid'; readonly output: RemovalGrid | null };

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
  }
}
