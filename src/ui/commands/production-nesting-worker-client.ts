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
): ProductionNestingSearch {
  const worker = new Worker(new URL('./nesting-worker.ts', import.meta.url), { type: 'module' });
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
    finish({ cancelled, best });
  };
  const error = (message: string): void => {
    if (settled) return;
    settled = true;
    worker.terminate();
    fail(new Error(message));
  };
  worker.onmessage = (event: MessageEvent<NestingWorkerResponse>): void => {
    if (settled) return;
    const response = event.data;
    if (response.kind === 'error') error(response.message);
    else if (response.kind === 'production-complete') close(false);
    else if (response.kind === 'production-progress') {
      best = response.progress.best;
      onProgress(response.progress);
    }
  };
  worker.onerror = (): void => error('Background quantity nesting failed.');
  worker.onmessageerror = (): void => error('Could not read the quantity nesting draft.');
  try {
    worker.postMessage({ kind: 'production-search', input } satisfies NestingWorkerRequest);
  } catch {
    error('Could not send the quantity nesting request.');
  }
  return { result, cancel: () => close(true) };
}
