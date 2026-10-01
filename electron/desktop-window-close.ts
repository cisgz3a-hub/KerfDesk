import { dialog, type BrowserWindow } from 'electron';
import { rendererCloseRequestScript } from './renderer-close-request.js';
import { WindowCloseGuard } from './window-close-guard.js';
import type { UnsavedCloseDecision, WindowUnloadDecision } from './window-unload-decision.js';

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
      options.isTrustedRenderer(window.webContents.getURL()) &&
      (gateApprovalId !== requestId ||
        (options.isWorkspaceAdmitted?.() === false &&
          options.isTrustedRenderer(window.webContents.getURL()))),
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
      // Save may open the file picker, which Chromium shows only for a user
      // gesture: here, the operator's Save click in the close question (ADR-549).
      return window.webContents.executeJavaScript(
        rendererCloseRequestScript(operation, requestId),
        operation === 'save',
      );
    },
    decideUnsaved: () => decideUnsaved(window),
    decideUnsavedClose: () => decideUnsavedClose(window),
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

// Closing KerfDesk (ADR-549): Save is the default, so Enter never discards work.
function decideUnsavedClose(window: BrowserWindow): UnsavedCloseDecision {
  const response = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'Unsaved changes',
    message: 'Save your changes before closing KerfDesk?',
    detail: "Changes you don't save may be lost.",
  });
  if (response === 0) return 'save';
  return response === 1 ? 'leave' : 'stay';
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
