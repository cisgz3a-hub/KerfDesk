import type {
  StampWorkerRequest,
  StampWorkerResponse,
  StampEncodedDraft,
} from './stamp-worker-protocol';
/** One worker belongs to this exact review. Abort terminates pixel work and
 * encoding; a late reply cannot settle or mutate a newer draft. */
export function prepareStampInWorker(
  input: StampWorkerRequest,
  signal: AbortSignal,
): Promise<StampEncodedDraft> {
  if (signal.aborted)
    return Promise.reject(new DOMException('Stamp preparation cancelled.', 'AbortError'));
  const worker = new Worker(new URL('./stamp-worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, draft?: StampEncodedDraft): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error !== null) reject(error);
      else if (draft !== undefined) resolve(draft);
    };
    const abort = (): void =>
      finish(new DOMException('Stamp preparation cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Stamp preparation timed out.')), 30_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<StampWorkerResponse>): void => {
      if (event.data.kind === 'ok') finish(null, event.data.draft);
      else finish(new Error(event.data.message));
    };
    worker.onerror = (): void => finish(new Error('Stamp preparation worker failed.'));
    worker.onmessageerror = (): void =>
      finish(new Error('Could not read the stamp preparation result.'));
    try {
      worker.postMessage(input);
    } catch {
      finish(new Error('Could not send pixels to the stamp worker.'));
    }
  });
}
