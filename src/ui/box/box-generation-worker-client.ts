import type { BoxSpec, GenerateBoxResult } from '../../core/box';
import type {
  BoxGenerationMetrics,
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from './box-generation-worker-protocol';

export class BoxGenerationCancelledError extends Error {
  override readonly name = 'BoxGenerationCancelledError';

  constructor() {
    super('Box generation cancelled');
  }
}

export type BoxGenerationTask = {
  readonly promise: Promise<BoxGenerationWorkerResult>;
  readonly cancel: () => void;
};

export type BoxGenerationWorkerResult = {
  readonly result: GenerateBoxResult;
  readonly metrics: BoxGenerationMetrics | null;
};

export function startBoxGeneration(id: number, spec: BoxSpec): BoxGenerationTask | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./box-generation-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }

  let isSettled = false;
  let rejectTask: ((error: Error) => void) | null = null;
  const promise = new Promise<BoxGenerationWorkerResult>((resolve, reject) => {
    rejectTask = reject;
    const rejectAndRetire = (error: Error): void => {
      if (isSettled) return;
      isSettled = true;
      retire(worker);
      reject(error);
    };
    worker.onmessage = (event: MessageEvent<BoxGenerationWorkerResponse>): void => {
      if (event.data.id !== id) {
        rejectAndRetire(new Error('Box generation worker returned a mismatched request.'));
        return;
      }
      if (event.data.kind === 'fatal') {
        rejectAndRetire(new Error(event.data.message));
        return;
      }
      if (isSettled) return;
      isSettled = true;
      retire(worker);
      resolve({ result: event.data.result, metrics: event.data.metrics });
    };
    worker.onerror = (): void => {
      rejectAndRetire(new Error('Background box generation worker errored.'));
    };
    worker.onmessageerror = (): void => {
      rejectAndRetire(new Error('Background box generation response could not be read.'));
    };
    const request: BoxGenerationWorkerRequest = { kind: 'generate', id, spec };
    try {
      worker.postMessage(request);
    } catch (error) {
      rejectAndRetire(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return {
    promise,
    cancel: () => {
      if (isSettled) return;
      isSettled = true;
      retire(worker);
      rejectTask?.(new BoxGenerationCancelledError());
    },
  };
}

function retire(worker: Worker): void {
  worker.onmessage = null;
  worker.onerror = null;
  worker.onmessageerror = null;
  worker.terminate();
}
