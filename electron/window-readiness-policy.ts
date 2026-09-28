interface WindowReadinessTarget {
  once(event: 'ready-to-show', listener: () => void): unknown;
  show(): void;
  readonly webContents: {
    once(event: 'did-finish-load', listener: () => void): unknown;
    on(
      event: 'did-fail-load' | 'render-process-gone',
      listener: (...args: ReadonlyArray<unknown>) => void,
    ): unknown;
  };
}

type WindowReadinessOptions = {
  readonly reportFailure?: (message: string) => void;
  /** How to reveal the window; a remembered maximized window opens maximized. */
  readonly reveal?: () => void;
};

/**
 * Registers the one-shot visibility transition for an initially hidden window.
 * Call this before renderer loading begins because `ready-to-show` can precede
 * `did-finish-load` during fast packaged startup.
 */
export function installWindowReadinessPolicy(
  window: WindowReadinessTarget,
  options: WindowReadinessOptions = {},
): void {
  let shown = false;
  const reveal = options.reveal ?? (() => window.show());
  const showOnce = (): void => {
    if (shown) return;
    shown = true;
    reveal();
  };
  window.once('ready-to-show', showOnce);
  // A successful renderer load is a deterministic fallback if Chromium never
  // emits ready-to-show. The idempotent transition prevents a double show.
  window.webContents.once('did-finish-load', showOnce);
  window.webContents.on('did-fail-load', () => {
    showOnce();
    options.reportFailure?.('KerfDesk could not load its application window.');
  });
  // A dead renderer still shows the window; renderer-crash-recovery.ts then
  // offers the reload (ADR-482).
  window.webContents.on('render-process-gone', showOnce);
}
