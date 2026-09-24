export function traceAbortError(): DOMException {
  return new DOMException('Trace cancelled', 'AbortError');
}

export function checkTraceSignal(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw traceAbortError();
}

export function isTraceAbort(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/** Abort the wait even when an underlying browser decoder cannot be interrupted. */
export function awaitTraceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(traceAbortError());
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort);
      reject(traceAbortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
