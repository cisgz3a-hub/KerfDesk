interface ApplicationLifecycleTarget {
  on(event: 'will-quit', listener: () => void): unknown;
}

interface ApplicationFinalCleanupOptions {
  readonly reportFailure?: (error: unknown) => void;
}

/** Run process-owned cleanup only after every window accepted the quit. */
export function installApplicationFinalCleanup(
  app: ApplicationLifecycleTarget,
  cleanup: () => Promise<void> | undefined,
  options: ApplicationFinalCleanupOptions = {},
): void {
  let started = false;
  app.on('will-quit', () => {
    if (started) return;
    started = true;
    try {
      void Promise.resolve(cleanup()).catch((error: unknown) => options.reportFailure?.(error));
    } catch (error) {
      options.reportFailure?.(error);
    }
  });
}
