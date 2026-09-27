import { screen, type BrowserWindow } from 'electron';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  parseSavedWindowPlacement,
  restoredWindowPlacement,
  serializeWindowPlacement,
  type WindowPlacement,
} from './window-placement.js';

const PLACEMENT_FILE = 'window-placement.json';

/** Where to open the main window (ADR-482). Call after app ready. */
export function loadWindowPlacement(userDataPath: string): WindowPlacement {
  let text = '';
  try {
    text = readFileSync(path.join(userDataPath, PLACEMENT_FILE), 'utf8');
  } catch {
    // First launch, or the file is unreadable: open at the default size.
  }
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
  return restoredWindowPlacement(parseSavedWindowPlacement(text), [
    primary.workArea,
    ...others.map((display) => display.workArea),
  ]);
}

/** Save the window's normal bounds and maximized state whenever it closes. */
export function rememberWindowPlacement(window: BrowserWindow, userDataPath: string): void {
  let maximized = false;
  window.on('maximize', () => (maximized = true));
  window.on('unmaximize', () => (maximized = false));
  window.on('close', () => {
    // A window closed from the taskbar while minimized reports neither state;
    // the last maximize/unmaximize event still knows which it was.
    const placement = {
      ...window.getNormalBounds(),
      maximized: window.isMinimized() ? maximized : window.isMaximized(),
    };
    const file = path.join(userDataPath, PLACEMENT_FILE);
    try {
      writeFileSync(`${file}.tmp`, serializeWindowPlacement(placement), 'utf8');
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      console.warn('Could not remember the window position:', error);
    }
  });
}
