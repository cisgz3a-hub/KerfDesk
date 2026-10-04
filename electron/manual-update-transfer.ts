/** A live transport is bounded both overall and while waiting for headers or
 * the next body chunk. Neither Content-Length nor byte progress is authority. */
export function manualDownloadDeadline() {
  const controller = new AbortController();
  const total = setTimeout(() => {
    controller.abort(new Error('The update download exceeded ten minutes.'));
  }, 10 * 60_000);
  return {
    signal: controller.signal,
    wait: async <T>(pending: Promise<T>): Promise<T> => {
      controller.signal.throwIfAborted();
      let rejectAbort!: (reason: unknown) => void;
      const interrupted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const abort = () => rejectAbort(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      const idle = setTimeout(() => {
        controller.abort(new Error('The update download stopped responding.'));
      }, 60_000);
      try {
        return await Promise.race([pending, interrupted]);
      } finally {
        clearTimeout(idle);
        controller.signal.removeEventListener('abort', abort);
      }
    },
    dispose: () => {
      clearTimeout(total);
      controller.abort();
    },
  };
}
