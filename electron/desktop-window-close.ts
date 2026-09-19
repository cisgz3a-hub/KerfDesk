import { dialog, type BrowserWindow } from 'electron';
import { rendererCloseRequestScript } from './renderer-close-request.js';
import { WindowCloseGuard } from './window-close-guard.js';
import type { WindowUnloadDecision } from './window-unload-decision.js';

interface DesktopCloseOptions {
  isTrustedRenderer(url: string): boolean;
  isQuitRequested(): boolean;
  cancelQuit(): void;
  quit(): void;
}

export function installDesktopWindowClose(
  window: BrowserWindow,
  options: DesktopCloseOptions,
): void {
  new WindowCloseGuard(window, {
    ...options,
    request: async (operation, requestId) => {
      if (!options.isTrustedRenderer(window.webContents.getURL())) {
        return { status: 'unavailable' };
      }
      return window.webContents.executeJavaScript(rendererCloseRequestScript(operation, requestId));
    },
    decideUnsaved: () => decideUnsaved(window),
    decideUnavailable: () => decideUnavailable(window),
    forceClose: () => window.destroy(),
    reportFailure: (error: unknown) => console.warn('Desktop close deferred:', error),
  });
}

function decideUnsaved(window: BrowserWindow): WindowUnloadDecision {
  const response = dialog.showMessageBoxSync(window, {
    type: 'question',
    buttons: ['Leave', 'Stay'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Unsaved changes',
    message: 'Leave without saving?',
    detail: 'Changes you made may not be saved.',
  });
  return response === 0 ? 'leave' : 'stay';
}

function decideUnavailable(window: BrowserWindow): WindowUnloadDecision {
  const response = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Keep app open', 'Close app'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'App controls unavailable',
    message: 'KerfDesk cannot reach its controls to finish closing.',
    detail:
      'Software Abort and saving cannot be confirmed. Closing may lose unsaved changes. ' +
      'Use the physical E-stop or power cutoff if the machine may be unsafe.',
  });
  return response === 1 ? 'leave' : 'stay';
}
