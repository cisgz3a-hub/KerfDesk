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
  const showOnce = (): void => {
    if (shown) return;
    shown = true;
    window.show();
  };
  window.once('ready-to-show', showOnce);
  // A successful renderer load is a deterministic fallback if Chromium never
  // emits ready-to-show. The idempotent transition prevents a double show.
  window.webContents.once('did-finish-load', showOnce);
  window.webContents.on('did-fail-load', () => {
    showOnce();
    options.reportFailure?.('KerfDesk could not load its application window.');
  });
  window.webContents.on('render-process-gone', () => {
    showOnce();
    options.reportFailure?.('The KerfDesk application window stopped unexpectedly.');
  });
}
