import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { contextMenuEntries, type ContextMenuEntry } from './editable-context-menu.js';

/** Show the text right-click menu the renderer did not cancel (ADR-482). */
export function installDesktopContextMenu(window: BrowserWindow): void {
  const contents = window.webContents;
  contents.on('context-menu', (_event, params) => {
    const entries = contextMenuEntries(params);
    if (entries.length === 0) return;
    Menu.buildFromTemplate(entries.map((entry) => menuItem(entry, window))).popup({ window });
  });
}

function menuItem(entry: ContextMenuEntry, window: BrowserWindow): MenuItemConstructorOptions {
  const contents = window.webContents;
  switch (entry.kind) {
    case 'role':
      return { role: entry.role, enabled: entry.enabled };
    case 'replace-misspelling':
      return { label: entry.word, click: () => contents.replaceMisspelling(entry.word) };
    case 'learn-spelling':
      return {
        label: 'Add to Dictionary',
        click: () => contents.session.addWordToSpellCheckerDictionary(entry.word),
      };
    case 'separator':
      return { type: 'separator' };
  }
}
