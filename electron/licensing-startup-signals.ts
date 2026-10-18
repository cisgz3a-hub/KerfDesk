export type WorkspaceAdmission = {
  /** Calls `listener` now with the current admission, and again on each change. */
  readonly onChange: (listener: (admitted: boolean) => void) => () => void;
  /** A renderer is opening: until it is sent Pro, no workspace is admitted. */
  readonly rendererOpening: () => void;
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
  const admission: WorkspaceAdmission = {
    onChange: (listener) => {
      listeners.add(listener);
      listener(admitted);
      return () => listeners.delete(listener);
    },
    rendererOpening: () => {
      if (!alwaysAdmitted) setAdmitted(false);
    },
  };
  return {
    admission,
    /** Notes a status sent to the renderer, and whether it admits the workspace. */
    observe: (status: { readonly edition: string }): void => {
      markStatusRead();
      if (status.edition === 'pro') setAdmitted(true);
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
