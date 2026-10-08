import type { NestingInput, NestingProgress, NestLayout } from '../../core/nesting/layout-nest';
import type { NestingWorkerRequest, NestingWorkerResponse } from './nesting-worker-protocol';

export type NestingSearch = {
  readonly result: Promise<{ readonly cancelled: boolean; readonly best: NestLayout | null }>;
  readonly cancel: () => void;
};

/** Each dialog owns one worker. Terminating it interrupts polygon work, while
 * retaining only the last complete, validated arrangement delivered to the UI. */
export function startNestingSearch(
  input: NestingInput,
  onProgress: (progress: NestingProgress) => void,
): NestingSearch {
  const worker = new Worker(new URL('./nesting-worker.ts', import.meta.url), { type: 'module' });
  let best: NestLayout | null = null;
  let settled = false;
  let finish: (value: { cancelled: boolean; best: NestLayout | null }) => void;
  let fail: (error: Error) => void;
  const result = new Promise<{ cancelled: boolean; best: NestLayout | null }>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
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
    else if (response.kind === 'complete') close(false);
    else {
      best = response.progress.best;
      onProgress(response.progress);
    }
  };
  worker.onerror = (): void => error('Background nesting search failed.');
  worker.onmessageerror = (): void => error('Could not read the nesting draft.');
  try {
    worker.postMessage({ kind: 'search', input } satisfies NestingWorkerRequest);
  } catch {
    error('Could not send the artwork to the nesting worker.');
  }
  return { result, cancel: () => close(true) };
}
