export type WorkspaceAdmission = {
  /** Calls `listener` now with the current admission, and again on each change. */
  readonly onChange: (listener: (admitted: boolean) => void) => () => void;
  /** A renderer is opening: until it is sent Pro, no workspace is admitted. */
  readonly rendererOpening: () => void;
  /** The renderer process died: with no workspace left, nothing is admitted. */
  readonly rendererGone: () => void;
};

/**
 * Signals for the window a commercial desktop app opens behind (ADR-623), fed
 * by each status the renderer is sent: whether a workspace is admitted, so
 * desktop services run only behind an admitted workspace, and when the first
 * status is answered, so a quiet refresh waiting on the network never holds
 * that read in the queue. A build without licensing is always admitted.
 */
export function createStartupSignals(alwaysAdmitted: boolean) {
  let admitted = alwaysAdmitted;
  // Each opening renderer is a new generation; replies to an older one admit nothing.
  let generation = 0;
  const listeners = new Set<(admitted: boolean) => void>();
  const setAdmitted = (next: boolean): void => {
    if (admitted === next) return;
    admitted = next;
    for (const listener of listeners) listener(next);
  };
  let markStatusRead: () => void = () => undefined;
  const statusRead = new Promise<void>((resolve) => {
    markStatusRead = resolve;
  });
  const resetRenderer = (): void => {
    generation += 1;
    if (!alwaysAdmitted) setAdmitted(false);
  };
  const admission: WorkspaceAdmission = {
    onChange: (listener) => {
      listeners.add(listener);
      listener(admitted);
      return () => listeners.delete(listener);
    },
    rendererOpening: () => resetRenderer(),
    rendererGone: () => resetRenderer(),
  };
  return {
    admission,
    /**
     * Starts watching one renderer request: the status it is sent counts only
     * if no renderer has opened since, as a reload or a reopened window would.
     */
    observeRequest: (): ((status: { readonly edition: string }) => void) => {
      const requested = generation;
      return (status) => {
        if (requested !== generation) return;
        markStatusRead();
        if (status.edition === 'pro') setAdmitted(true);
      };
    },
    /** Resolves once a status has been read, or after `ms` if none is. */
    afterFirstStatusRead: (ms: number): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const elapsed = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
      return Promise.race([statusRead, elapsed]).finally(() => clearTimeout(timer));
    },
  };
}
