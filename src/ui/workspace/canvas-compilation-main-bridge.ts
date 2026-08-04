import { BoundedCompilationMainBridge } from './bounded-compilation-main-bridge';
import type { BoundedCompilationBridgePort } from './bounded-compilation-bridge-protocol';
import type { BoundedCompilationWorkerLike } from './bounded-compilation-worker-pool';
import {
  CANVAS_COMPILATION_BRIDGE_CONNECTION,
  type CanvasCompilationBridgeConnection,
  type CanvasCompilationTaskPayload,
  type CanvasCompilationTaskResult,
} from './canvas-compilation-worker-protocol';

const DEFAULT_PARALLEL_WORKER_COUNT = 2;
const CAPABLE_DEVICE_PARALLEL_WORKER_COUNT = 3;
const MIN_HARDWARE_CONCURRENCY_FOR_CAPABLE_DEVICE = 4;
const OUTER_WORKER_LIMIT = 5;
const ACTIVE_JOB_LIMIT = 4;

type OuterWorker = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
};

let sharedBridge: BoundedCompilationMainBridge<
  CanvasCompilationTaskPayload,
  CanvasCompilationTaskResult
> | null = null;
const detachByWorker = new Map<OuterWorker, () => void>();

/** Main-realm hook called immediately after an outer Worker is constructed. */
export function connectCanvasCompilationMainBridge(worker: OuterWorker): void {
  if (detachByWorker.has(worker)) return;
  if (typeof MessageChannel === 'undefined') {
    worker.terminate();
    throw new Error('canvas compilation bridge unavailable');
  }
  const channel = new MessageChannel();
  let detach: () => void;
  try {
    detach = bridge().attach(compilationPort(channel.port1));
  } catch (error) {
    channel.port1.close();
    channel.port2.close();
    worker.terminate();
    throw error;
  }
  const connection: CanvasCompilationBridgeConnection = {
    kind: CANVAS_COMPILATION_BRIDGE_CONNECTION,
    port: compilationPort(channel.port2),
  };
  try {
    worker.postMessage(connection, [channel.port2]);
    detachByWorker.set(worker, detach);
  } catch (error) {
    detach();
    channel.port2.close();
    worker.terminate();
    throw error;
  }
}

/** Main-realm hook called before the corresponding outer Worker is terminated. */
export function retireCanvasCompilationMainBridge(worker: OuterWorker): void {
  const detach = detachByWorker.get(worker);
  if (detach === undefined) return;
  detachByWorker.delete(worker);
  detach();
}

export function resetCanvasCompilationMainBridgeForTests(): void {
  for (const detach of Array.from(detachByWorker.values())) detach();
  detachByWorker.clear();
  sharedBridge?.dispose();
  sharedBridge = null;
}

/**
 * Leave one logical processor available to the browser on a four-thread device.
 * The broker's dedicated serial recovery Worker may coexist with these slots,
 * so three healthy lanes also preserves the architecture-wide four-Worker cap.
 */
export function canvasCompilationParallelWorkerCount(
  hardwareConcurrency: number | undefined,
): number {
  if (typeof hardwareConcurrency !== 'number' || !Number.isFinite(hardwareConcurrency)) {
    return DEFAULT_PARALLEL_WORKER_COUNT;
  }
  return Math.trunc(hardwareConcurrency) >= MIN_HARDWARE_CONCURRENCY_FOR_CAPABLE_DEVICE
    ? CAPABLE_DEVICE_PARALLEL_WORKER_COUNT
    : DEFAULT_PARALLEL_WORKER_COUNT;
}

function bridge(): BoundedCompilationMainBridge<
  CanvasCompilationTaskPayload,
  CanvasCompilationTaskResult
> {
  if (sharedBridge !== null) return sharedBridge;
  sharedBridge = new BoundedCompilationMainBridge({
    concurrency: canvasCompilationParallelWorkerCount(
      typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
    ),
    maxSources: OUTER_WORKER_LIMIT,
    maxActiveJobs: ACTIVE_JOB_LIMIT,
    createWorker: createCanvasCompilationWorker,
  });
  return sharedBridge;
}

function createCanvasCompilationWorker(): BoundedCompilationWorkerLike<CanvasCompilationTaskPayload> {
  if (typeof Worker === 'undefined') throw new Error('canvas compilation workers unavailable');
  return new Worker(new URL('./canvas-compilation-worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as BoundedCompilationWorkerLike<CanvasCompilationTaskPayload>;
}

function compilationPort(port: MessagePort): BoundedCompilationBridgePort {
  return port as unknown as BoundedCompilationBridgePort;
}
