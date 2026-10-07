import type { BrowserWindow } from 'electron';
import { installDesktopWindowClose } from './desktop-window-close.js';
import { createManualCloseApproval } from './manual-update-quit.js';

/** The explicit update action retains each window's ordinary save/close owner. */
export function createDesktopUpdateClose(app: { quit(): void }, windows: () => BrowserWindow[]) {
  const approval = createManualCloseApproval();
  let pending = new WeakSet<BrowserWindow>();
  let cancelInstall: (() => void) | null = null;
  const guards = new WeakMap<BrowserWindow, ReturnType<typeof installDesktopWindowClose>>();
  const cancelUpdateClose = (): void => {
    const cancel = cancelInstall;
    cancelInstall = null;
    pending = new WeakSet<BrowserWindow>();
    cancel?.();
  };
  return {
    canInstall: approval.canInstall,
    request: (cancel: () => void): void => {
      const targets = windows();
      // A separate ordinary close already owns its preparation/recovery decision.
      if (
        targets.length === 0 ||
        targets.some((window) => window.isDestroyed() || guards.get(window)?.isClosing() !== false)
      ) {
        cancel();
        return;
      }
      cancelInstall = cancel;
      for (const window of targets) pending.add(window);
      app.quit();
    },
    install: (window: BrowserWindow, options: Parameters<typeof installDesktopWindowClose>[1]) => {
      const guard = installDesktopWindowClose(window, {
        ...options,
        isUpdateCloseRequested: () => pending.has(window),
        cancelQuit: () => {
          if (pending.has(window)) cancelUpdateClose();
          options.cancelQuit();
        },
      });
      approval.observe(window, guard);
      guards.set(window, guard);
      return guard;
    },
  };
}
