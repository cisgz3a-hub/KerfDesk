import type { BrowserWindow } from 'electron';
import { installDesktopWindowClose } from './desktop-window-close.js';
import { createManualCloseApproval } from './manual-update-quit.js';

/** The explicit update action retains each window's ordinary save/close owner. */
export function createDesktopUpdateClose(app: { quit(): void }, windows: () => BrowserWindow[]) {
  const approval = createManualCloseApproval();
  const pending = new WeakSet<BrowserWindow>();
  const guards = new WeakMap<BrowserWindow, ReturnType<typeof installDesktopWindowClose>>();
  return {
    canInstall: approval.canInstall,
    request: (): void => {
      const targets = windows();
      // A separate ordinary close already owns its preparation/recovery decision.
      if (
        targets.length === 0 ||
        targets.some((window) => window.isDestroyed() || guards.get(window)?.isClosing() !== false)
      )
        return;
      for (const window of targets) pending.add(window);
      app.quit();
    },
    install: (window: BrowserWindow, options: Parameters<typeof installDesktopWindowClose>[1]) => {
      const guard = installDesktopWindowClose(window, {
        ...options,
        isUpdateCloseRequested: () => pending.has(window),
        cancelQuit: () => {
          pending.delete(window);
          options.cancelQuit();
        },
      });
      approval.observe(window, guard);
      guards.set(window, guard);
      return guard;
    },
  };
}
