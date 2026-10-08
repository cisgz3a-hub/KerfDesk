import { recordOwnedReliefComposition } from '../../core/relief/relief-authoring-composition-proof';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import type { ReliefAuthoringMaterializationResult } from '../../core/relief/materialize-relief-authoring';

type AuthoringWorker = Pick<Worker, 'onmessage' | 'onerror' | 'postMessage' | 'terminate'>;
export type ReliefAuthoringWorkerRuntime = { readonly createWorker: () => AuthoringWorker };
const runtime: ReliefAuthoringWorkerRuntime = {
  createWorker: () =>
    new Worker(new URL('./relief-authoring-worker.ts', import.meta.url), { type: 'module' }),
};

/** One request owns one worker. Abort disposes it; late events cannot publish. */
export function composeReliefInWorker(
  document: ReliefAuthoringDocument,
  signal: AbortSignal,
  onProgress: (fraction: number) => void = () => undefined,
  owner: ReliefAuthoringWorkerRuntime = runtime,
): Promise<ReliefAuthoringMaterializationResult> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ kind: 'cancelled' });
      return;
    }
    let worker: AuthoringWorker;
    try {
      worker = owner.createWorker();
    } catch (error) {
      resolve({
        kind: 'error',
        reason: error instanceof Error ? error.message : 'Relief worker unavailable.',
      });
      return;
    }
    let settled = false;
    const finish = (result: ReliefAuthoringMaterializationResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      resolve(result);
    };
    const abort = (): void => finish({ kind: 'cancelled' });
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) =>
      finish({ kind: 'error', reason: event.message || 'Relief worker failed.' });
    worker.onmessage = (event: MessageEvent) => {
      if (settled || signal.aborted) return;
      const value = event.data as {
        kind?: string;
        fraction?: number;
        result?: ReliefAuthoringMaterializationResult;
      };
      if (value.kind === 'progress' && typeof value.fraction === 'number')
        onProgress(value.fraction);
      if (value.kind === 'result' && value.result !== undefined) {
        if (value.result.kind === 'ok') recordOwnedReliefComposition(document, value.result.field);
        finish(value.result);
      }
    };
    try {
      worker.postMessage(document);
    } catch (error) {
      finish({
        kind: 'error',
        reason: error instanceof Error ? error.message : 'Relief worker request failed.',
      });
    }
  });
}
