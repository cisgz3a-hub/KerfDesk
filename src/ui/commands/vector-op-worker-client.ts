// Main-thread client for src/ui/commands/vector-op-worker.ts (ADR-606).
//
// One session belongs to one open dialog. Its worker holds the dialog's source
// objects, so the selection crosses the boundary once (packed, ADR-346) and an
// edit posts only its options.
//
// Supersede terminates. An offset of a traced image measured 40-70 s inside
// clipper, which cannot be interrupted; dropping the stale reply by id (as the
// box and kerf workers do) would leave the operator's newest value queued
// behind that work. A newer request therefore retires a busy worker, resolves
// the older request as superseded, and starts the newest one in a fresh worker
// at once. An idle worker is reused. Releasing the session (the dialog closed)
// also terminates any running work.
//
// Only SSR and Vitest, which have no Worker runtime, compute in process. A real
// browser whose worker cannot start reports the preview unavailable instead of
// moving the work back onto the UI thread.

import type { VectorSceneObject } from '../../core/geometry';
import { packSceneObjectsMessage } from '../packed-scene-objects-transfer';
import type { VectorOpRequest, VectorOpResponse, VectorOpTask } from './vector-op-worker-protocol';
import {
  runVectorOpTask,
  vectorOpResult,
  type VectorOpResultFor,
} from './vector-op-worker-runtime';

export type VectorOpOutcome<R> =
  | { readonly kind: 'done'; readonly result: R }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'unavailable'; readonly message: string };

export type VectorOpSession = {
  readonly run: <T extends VectorOpTask>(
    sources: ReadonlyArray<VectorSceneObject>,
    task: T,
  ) => Promise<VectorOpOutcome<VectorOpResultFor<T>>>;
  /** Cancels running work and releases the worker. The session stays usable. */
  readonly release: () => void;
};

export type VectorOpWorkerSpawner = () => Worker | null;

const UNAVAILABLE_MESSAGE = 'The preview could not run in the background.';
const WORKER_ERROR_MESSAGE = 'The background preview stopped unexpectedly.';
const MESSAGE_ERROR_MESSAGE = 'The background preview reply could not be read.';

type ActiveRequest = {
  readonly id: number;
  readonly task: VectorOpTask;
  readonly settle: (outcome: VectorOpOutcome<unknown>) => void;
};

export function createVectorOpSession(
  spawn: VectorOpWorkerSpawner = spawnVectorOpWorker,
): VectorOpSession {
  const session = new VectorOpWorkerSession(spawn);
  return {
    run: (sources, task) => session.run(sources, task),
    release: () => session.release(),
  };
}

class VectorOpWorkerSession {
  private worker: Worker | null = null;
  private loaded: ReadonlyArray<VectorSceneObject> | null = null;
  private active: ActiveRequest | null = null;
  private nextId = 0;

  constructor(private readonly spawn: VectorOpWorkerSpawner) {}

  run<T extends VectorOpTask>(
    sources: ReadonlyArray<VectorSceneObject>,
    task: T,
  ): Promise<VectorOpOutcome<VectorOpResultFor<T>>> {
    return new Promise((resolve) => {
      if (this.active !== null) {
        this.settleActive({ kind: 'superseded' });
        this.retire();
      }
      const target = this.ensureWorker();
      if (target === null) {
        resolve(inProcessOutcome(sources, task));
        return;
      }
      this.nextId += 1;
      const id = this.nextId;
      this.active = { id, task, settle: resolve as (outcome: VectorOpOutcome<unknown>) => void };
      try {
        this.post(target, id, sources, task);
      } catch {
        this.fail(UNAVAILABLE_MESSAGE);
      }
    });
  }

  release(): void {
    this.settleActive({ kind: 'superseded' });
    this.retire();
  }

  private settleActive(outcome: VectorOpOutcome<unknown>): void {
    const current = this.active;
    this.active = null;
    current?.settle(outcome);
  }

  private retire(): void {
    const worker = this.worker;
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    this.worker = null;
    this.loaded = null;
  }

  private fail(message: string): void {
    this.retire();
    this.settleActive({ kind: 'unavailable', message });
  }

  private receive(response: VectorOpResponse): void {
    const current = this.active;
    if (current === null || response.id !== current.id) return;
    if (response.kind === 'fatal') {
      this.settleActive({ kind: 'unavailable', message: response.message });
      return;
    }
    let result: unknown;
    try {
      result = vectorOpResult(current.task, response);
    } catch {
      this.fail(MESSAGE_ERROR_MESSAGE);
      return;
    }
    this.settleActive({ kind: 'done', result });
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== null) return this.worker;
    const created = this.spawn();
    if (created === null) return null;
    created.onmessage = (event: MessageEvent<VectorOpResponse>) => this.receive(event.data);
    created.onerror = () => this.fail(WORKER_ERROR_MESSAGE);
    created.onmessageerror = () => this.fail(MESSAGE_ERROR_MESSAGE);
    this.worker = created;
    return created;
  }

  private post(
    target: Worker,
    id: number,
    sources: ReadonlyArray<VectorSceneObject>,
    task: VectorOpTask,
  ): void {
    if (this.loaded === sources) {
      const request: VectorOpRequest = { id, task };
      target.postMessage(request);
      return;
    }
    const packed = packSceneObjectsMessage(sources);
    const request: VectorOpRequest = { id, task, sources: packed.message };
    target.postMessage(request, packed.transfer);
    this.loaded = sources;
  }
}

function inProcessOutcome<T extends VectorOpTask>(
  sources: ReadonlyArray<VectorSceneObject>,
  task: T,
): VectorOpOutcome<VectorOpResultFor<T>> {
  if (!inProcessAllowed()) return { kind: 'unavailable', message: UNAVAILABLE_MESSAGE };
  return { kind: 'done', result: runVectorOpTask(sources, task) };
}

// SSR and Vitest have no browser worker runtime. A real browser must never
// silently move this costly geometry back onto its input thread.
function inProcessAllowed(): boolean {
  if (typeof Worker !== 'undefined') return false;
  const nodeTest =
    import.meta.env.MODE === 'test' &&
    typeof process !== 'undefined' &&
    process.versions?.node !== undefined;
  return import.meta.env.SSR || nodeTest;
}

function spawnVectorOpWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./vector-op-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}
