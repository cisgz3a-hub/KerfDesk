// The main window's crash handling, wired to Electron (ADR-482): the offer to
// reload is a native message box, and a network session the dead renderer
// still holds gets the stop first (rolling audit v11 W3-P1-1).

import { dialog, type BrowserWindow } from 'electron';
import { stopDesktopMachineNetwork } from './machine-network-routes.js';
import { installRendererCrashRecovery } from './renderer-crash-recovery.js';

export function installDesktopRendererCrashRecovery(
  window: BrowserWindow,
  isClosing: () => boolean,
): void {
  installRendererCrashRecovery(window, {
    isClosing,
    stopMachine: () => stopDesktopMachineNetwork(),
    askToReload: async (prompt) => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: [...prompt.buttons],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'KerfDesk',
        message: prompt.message,
        detail: prompt.detail,
      });
      return result.response === 0;
    },
    reportFailure: (error: unknown) => console.warn('Renderer reload offer failed:', error),
  });
}
