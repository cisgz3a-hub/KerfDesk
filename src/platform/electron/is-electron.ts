// Detects whether the renderer is running inside the Electron desktop shell
// rather than a browser. Used ONLY to feature-gate UI chrome — hiding the PWA
// "Install" and "Download for Windows" affordances inside the desktop app,
// where they make no sense (ADR-024). It never gates capability or behavior:
// that flows through the injected PlatformAdapter (ADR-011). The same web
// adapter drives both targets, so this is a cosmetic hint, not a code path.
//
// Pure: reads the runtime environment by default, but accepts an explicit env
// for tests.

export type ElectronDetectionEnv = {
  readonly userAgent?: string;
  readonly protocol?: string;
};

// Signals mirror electron/main.ts's renderer runtime:
//   * The packaged app serves the renderer over the custom `app://` scheme
//     (RENDERER_RUNTIME in electron/main.ts) → location.protocol === 'app:'.
//   * `pnpm dev:desktop` loads the Vite dev server over http://localhost, where
//     only the Electron user-agent token (e.g. "Electron/42.3.0") separates it
//     from an ordinary browser tab.
export function isElectronRenderer(env?: ElectronDetectionEnv): boolean {
  const userAgent = env?.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const protocol = env?.protocol ?? (typeof location === 'undefined' ? '' : location.protocol);
  return /electron\//i.test(userAgent) || protocol === 'app:';
}
