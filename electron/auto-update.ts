// LaserForge 2.0 desktop auto-update wiring (ADR-024).
//
// electron-updater runs in the MAIN process against our own self-hosted generic
// feed (see `publish` in electron-builder.yml). Design constraints:
//   * Runs ONLY in the packaged app (`app.isPackaged`). A dev run
//     (`pnpm dev:desktop`) must never touch the network or the updater singleton.
//   * `autoDownload` + `autoInstallOnAppQuit`: download in the background and
//     apply the update on the next natural quit.
//   * We NEVER call `quitAndInstall()`. Force-installing mid-session could abort
//     a running burn (PROJECT.md non-negotiable #9). Install-on-quit is the only
//     path, and a quit cannot happen mid-burn without the operator stopping the
//     job first (`src/ui/app/use-unload-stop.ts` soft-resets on unload).
// Because the check lives in main, the renderer CSP is untouched and no
// preload/IPC surface is needed — the OS-native "update ready" notification
// from `checkForUpdatesAndNotify` is the entire user-facing surface.

// Structural subset of electron-updater's `AppUpdater` — only the members we
// touch. Declaring it here (rather than importing the type) keeps this module
// and its unit test free of `electron-updater`, which transitively loads the
// native `electron` module that isn't available under Vitest.
export type DesktopUpdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  readonly checkForUpdatesAndNotify: () => Promise<unknown>;
};

export type ConfigureAutoUpdateOptions = {
  // Pass `app.isPackaged`. Guards every side effect so unpackaged runs are inert.
  readonly isPackaged: boolean;
  // Optional sink for a failed update check (e.g. offline). Defaults to swallowing
  // the error — a missing update feed must never crash or block app startup.
  readonly onError?: (error: unknown) => void;
};

// Configure and kick off the one background update check. No-op that touches
// nothing unless packaged.
export function configureAutoUpdater(
  updater: DesktopUpdater,
  options: ConfigureAutoUpdateOptions,
): void {
  if (!options.isPackaged) return;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  void updater.checkForUpdatesAndNotify().catch((error: unknown) => {
    options.onError?.(error);
  });
}
