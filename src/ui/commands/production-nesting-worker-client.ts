import type {
  ProductionNestResult,
  ProductionNestingInput,
  ProductionNestingProgress,
} from '../../core/nesting/production-nest';
import type { NestingWorkerRequest, NestingWorkerResponse } from './nesting-worker-protocol';

export type ProductionNestingSearch = {
  readonly result: Promise<{
    readonly cancelled: boolean;
    readonly best: ProductionNestResult | null;
  }>;
  readonly cancel: () => void;
};
export function startProductionNestingSearch(
  input: ProductionNestingInput,
  onProgress: (progress: ProductionNestingProgress) => void,
  advanced = false,
): ProductionNestingSearch {
  const worker = new Worker(new URL('./nesting-worker.ts', import.meta.url), { type: 'module' });
  const available =
    advanced && globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';
  let lastProgress: ProductionNestingProgress | null = null;
  let best: ProductionNestResult | null = null,
    settled = false;
  let finish: (value: { cancelled: boolean; best: ProductionNestResult | null }) => void;
  let fail: (error: Error) => void;
  const result = new Promise<{ cancelled: boolean; best: ProductionNestResult | null }>(
    (resolve, reject) => {
      finish = resolve;
      fail = reject;
    },
  );
  const close = (cancelled: boolean): void => {
    if (settled) return;
    settled = true;
    worker.terminate();
    engine.shutdown();
    finish({ cancelled, best });
  };
  const error = (message: string): void => {
    if (settled) return;
    if (advanced && best !== null) {
      notice(message + ' The best valid draft is retained.');
      close(false);
      return;
    }
    settled = true;
    worker.terminate();
    engine.shutdown();
    fail(new Error(message));
  };
  const notice = (message: string): void => {
    if (lastProgress !== null) onProgress({ ...lastProgress, notice: message });
  };
  const engine = advancedEngine(
    worker,
    () => settled,
    notice,
    () => close(false),
  );
  worker.onmessage = (event: MessageEvent<NestingWorkerResponse>): void => {
    if (settled) return;
    const response = event.data;
    if (response.kind === 'error') error(response.message);
    else if (response.kind === 'advanced-start' && available) engine.start(response.instance);
    else if (response.kind === 'production-complete') close(false);
    else if (response.kind === 'production-progress') {
      best = response.progress.best;
      lastProgress = response.progress;
      onProgress(
        advanced && !available
          ? {
              ...response.progress,
              notice:
                'Advanced optimisation is unavailable in this browser context. The standard draft is retained.',
            }
          : response.progress,
      );
    }
  };
  worker.onerror = (): void => error('Background quantity nesting failed.');
  worker.onmessageerror = (): void => error('Could not read the quantity nesting draft.');
  try {
    worker.postMessage({
      kind: 'production-search',
      input,
      ...(available ? { advanced: true } : {}),
    } satisfies NestingWorkerRequest);
  } catch {
    error('Could not send the quantity nesting request.');
  }
  return { result, cancel: () => close(true) };
}

function advancedEngine(
  worker: Worker,
  settled: () => boolean,
  notice: (message: string) => void,
  close: () => void,
) {
  let engine: Worker | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stopEngine = (message?: string): void => {
    engine?.terminate();
    engine = null;
    // Keep the deadline until the validation worker has consumed its queued
    // certificates too; a completed solver must not leave validation unbounded.
    if (!settled())
      worker.postMessage({
        kind: 'advanced-finished',
        ...(message === undefined ? {} : { notice: message }),
      } satisfies NestingWorkerRequest);
  };
  const startEngine = (instance: string): void => {
    if (engine !== null) return;
    try {
      engine = new Worker(new URL('packing-solver-worker.js', document.baseURI));
      engine.onmessage = (event: MessageEvent<unknown>): void => {
        if (settled() || engine === null) return;
        const data = event.data;
        if (data === null || typeof data !== 'object')
          return stopEngine('The advanced engine returned an unreadable result.');
        const value = data as Record<string, unknown>;
        if (
          value.kind === 'certificate' &&
          typeof value.certificate === 'string' &&
          value.certificate.length <= 16_000_000
        )
          worker.postMessage({
            kind: 'advanced-result',
            certificate: value.certificate,
          } satisfies NestingWorkerRequest);
        else if (value.kind === 'complete') stopEngine();
        else stopEngine('Advanced optimisation stopped. The best valid draft is retained.');
      };
      engine.onerror = (): void =>
        stopEngine('Advanced optimisation is unavailable. The standard draft is retained.');
      engine.onmessageerror = (): void =>
        stopEngine('The advanced result could not be read. The best valid draft is retained.');
      timeout = setTimeout(() => {
        notice('Advanced optimisation reached its time limit. The best valid draft is retained.');
        close();
      }, 15_000);
      engine.postMessage({ kind: 'start', instance });
    } catch {
      stopEngine('Advanced optimisation is unavailable. The standard draft is retained.');
    }
  };
  return {
    start: startEngine,
    shutdown(): void {
      engine?.terminate();
      engine = null;
      clearTimeout(timeout);
    },
  };
}
