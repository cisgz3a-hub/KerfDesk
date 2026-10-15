import type { ColoredPath } from '../../core/scene';
import type { TracePartGroupMode } from '../../core/trace/trace-part-groups';
import { packColoredPathMessage } from '../packed-project-transfer';
import { reserveWorkerMemory } from '../worker-memory-lane';
import type { TracePartWorkerRequest, TracePartWorkerResponse } from './trace-part-worker-protocol';

type Success = Extract<TracePartWorkerResponse, { readonly kind: 'ok' }>;
type Pending = {
  readonly id: number;
  readonly resolve: (result: Success) => void;
  readonly reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};
type Session = {
  worker: Worker | null;
  release: (() => void) | null;
  pending: Pending | null;
};

export const TRACE_PART_WORKER_TIMEOUT_MS = 30_000;
let session: Session | null = null;
let nextId = 0;

export class TracePartPreparationCancelled extends Error {
  override readonly name = 'TracePartPreparationCancelled';
}

/**
 * One path payload at a time. Reuse the worker for successive paths in the
 * same preparation, and call cancelTracePartWorker when that session ends.
 */
export function prepareTracePartPathOffThread(
  path: ColoredPath,
  mode: TracePartGroupMode | null,
): Promise<Success> {
  if (session?.pending != null) cancelTracePartWorker();
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Workers are unavailable.'));
  const current: Session = session ?? { worker: null, release: null, pending: null };
  session = current;
  return new Promise((resolve, reject) => {
    const active: Pending = { id: ++nextId, resolve, reject, timer: null };
    current.pending = active;
    if (current.worker !== null) {
      send(current, active, path, mode);
      return;
    }
    const reservation = reserveWorkerMemory(
      (release) => {
        current.release = release;
        if (session !== current) {
          release();
          return;
        }
        try {
          const worker = new Worker(new URL('./trace-part-worker.ts', import.meta.url), {
            type: 'module',
          });
          current.worker = worker;
          worker.onmessage = (event: MessageEvent<TracePartWorkerResponse>): void => {
            const waiting = current.pending;
            if (session !== current || waiting === null || event.data.id !== waiting.id) return;
            const response = event.data;
            if (response.kind === 'error') retire(current, new Error(response.message));
            else {
              current.pending = null;
              if (waiting.timer !== null) clearTimeout(waiting.timer);
              waiting.resolve(response);
            }
          };
          worker.onerror = (): void =>
            retire(current, new Error('Trace preparation worker failed.'));
          worker.onmessageerror = (): void =>
            retire(current, new Error('Trace preparation response could not be read.'));
          send(current, active, path, mode);
        } catch (error) {
          retire(current, error instanceof Error ? error : new Error(String(error)));
        }
      },
      { priority: 'interactive' },
    );
    if (current.release === null) current.release = reservation;
    if (session !== current) reservation();
  });
}

export function cancelTracePartWorker(): void {
  if (session !== null)
    retire(session, new TracePartPreparationCancelled('Trace preparation cancelled.'));
}

function send(
  current: Session,
  active: Pending,
  path: ColoredPath,
  mode: TracePartGroupMode | null,
): void {
  try {
    active.timer = setTimeout(
      () => retire(current, new Error('Trace preparation timed out.')),
      TRACE_PART_WORKER_TIMEOUT_MS,
    );
    const packed = packColoredPathMessage(path);
    const request: TracePartWorkerRequest = { id: active.id, path: packed.path, mode };
    current.worker?.postMessage(request, packed.transfer);
  } catch (error) {
    retire(current, error instanceof Error ? error : new Error(String(error)));
  }
}

function retire(current: Session, error: Error): void {
  if (session !== current) return;
  session = null;
  const active = current.pending;
  current.pending = null;
  if (active?.timer != null) clearTimeout(active.timer);
  const worker = current.worker;
  current.worker = null;
  if (worker !== null) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
  current.release?.();
  current.release = null;
  active?.reject(error);
}
