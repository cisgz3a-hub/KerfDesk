import type { ManualUpdates } from './manual-update.js';

interface QuitApplication {
  on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  relaunch(options: { execPath: string; args: string[] }): void;
  quit(): void;
}

export function createManualCloseApproval() {
  let sessionEnding = false;
  let approved = (): boolean => false;
  return {
    canInstall: (): boolean => !sessionEnding && approved(),
    observe: (
      window: { on(event: 'query-session-end' | 'session-end', listener: () => void): unknown },
      guard: { wasClosedWithApproval(): boolean },
    ): void => {
      approved = () => guard.wasClosedWithApproval();
      window.on('query-session-end', () => {
        sessionEnding = true;
      });
      window.on('session-end', () => {
        sessionEnding = true;
      });
    },
  };
}

/** Never initiates a close. Only a completed, trusted ordinary close may install. */
export function installManualUpdateQuit(
  app: QuitApplication,
  updates: ManualUpdates,
  options: {
    readonly canInstall: () => boolean;
    readonly reportFailure?: (error: unknown) => void;
  },
): void {
  let finishing = false;
  app.on('will-quit', (event) => {
    if (finishing || updates.status().installOnQuit !== true || !options.canInstall()) return;
    event.preventDefault();
    finishing = true;
    void boundedPreparation(updates.prepareInstall())
      .then((path) => {
        // A session end may have arrived while the disk was being reverified.
        // relaunch starts the executable AFTER this process exits. No shell or
        // NSIS update/silent/force-run arguments can bypass the interactive flow.
        if (path !== null && options.canInstall()) app.relaunch({ execPath: path, args: [] });
      })
      .catch((error: unknown) => options.reportFailure?.(error))
      .finally(() => {
        // Already accepted every window's close. A failed update cannot prevent quit.
        app.quit();
      });
  });
}

async function boundedPreparation(work: Promise<string | null>): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
