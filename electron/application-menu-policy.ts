export type DesktopApplicationMenuRole = 'appMenu' | 'fileMenu' | 'editMenu' | 'windowMenu';

export interface DesktopApplicationMenuItem {
  readonly role: DesktopApplicationMenuRole;
}

/**
 * KerfDesk owns its visible menu in the renderer. Windows and Linux therefore
 * suppress Electron's automatic duplicate menu. macOS retains the native
 * application, close, edit, and window roles expected by the platform, but
 * deliberately omits Electron's View menu because it registers reload and
 * DevTools accelerators that conflict with application shortcuts.
 */
export function desktopApplicationMenuTemplate(
  platform: NodeJS.Platform,
): DesktopApplicationMenuItem[] | null {
  if (platform !== 'darwin') return null;
  return [{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
}

export function shouldEnableDesktopDevTools(isPackaged: boolean): boolean {
  return !isPackaged;
}
