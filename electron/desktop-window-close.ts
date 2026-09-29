import { dialog, type BrowserWindow } from 'electron';
import { rendererCloseRequestScript } from './renderer-close-request.js';
import { WindowCloseGuard } from './window-close-guard.js';
import type { WindowUnloadDecision } from './window-unload-decision.js';

interface DesktopCloseOptions {
  isTrustedRenderer(url: string): boolean;
  isWorkspaceAdmitted?(): boolean;
  isQuitRequested(): boolean;
  cancelQuit(): void;
  quit(): void;
}

export function installDesktopWindowClose(
  window: BrowserWindow,
  options: DesktopCloseOptions,
): WindowCloseGuard {
  let gatePreparedId: number | null = null;
  let gateApprovalId: number | null = null;
  return new WindowCloseGuard(window, {
    ...options,
    isApprovalCurrent: (requestId) =>
      gateApprovalId !== requestId ||
      (options.isWorkspaceAdmitted?.() === false &&
        options.isTrustedRenderer(window.webContents.getURL())),
    request: async (operation, requestId) => {
      if (!options.isTrustedRenderer(window.webContents.getURL())) {
        return { status: 'unavailable' };
      }
      if (options.isWorkspaceAdmitted?.() === false) {
        if (operation === 'prepare') {
          gatePreparedId = requestId;
          return { status: 'ready', dirty: false };
        }
        if (operation === 'approve') gateApprovalId = requestId;
        return { status: operation === 'approve' ? 'approved' : 'cancelled' };
      }
      // Admission may settle between prepare and approve. The new workspace
      // must receive its own complete handoff, even before its receiver mounts.
      if (operation === 'approve' && gatePreparedId === requestId) return { status: 'retry' };
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
