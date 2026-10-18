/**
 * One-shot signals for the window a commercial desktop app opens behind
 * (ADR-623), fed by each status the renderer is sent: when it first reports
 * Pro, so desktop services may start, and when the first status is answered, so
 * a quiet refresh waiting on the network never holds that read in the queue.
 */
export function createStartupSignals(admitAtOnce: boolean) {
  let markAdmitted: () => void = () => undefined;
  const admitted = new Promise<void>((resolve) => {
    markAdmitted = resolve;
  });
  let markStatusRead: () => void = () => undefined;
  const statusRead = new Promise<void>((resolve) => {
    markStatusRead = resolve;
  });
  if (admitAtOnce) markAdmitted();
  return {
    /** Settles at the first Pro status; at once for a build without licensing. */
    admitted,
    /** Notes a status sent to the renderer, and whether it admits the workspace. */
    observe: (status: { readonly edition: string }): void => {
      markStatusRead();
      if (status.edition === 'pro') markAdmitted();
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
