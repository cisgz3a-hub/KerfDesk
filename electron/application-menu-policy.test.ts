import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  desktopApplicationMenuTemplate,
  shouldEnableDesktopDevTools,
} from './application-menu-policy.js';

function mainProcessSource(): string {
  return readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
}

describe('Electron application menu ownership', () => {
  it('suppresses Electron native menus when the renderer owns them', () => {
    expect(desktopApplicationMenuTemplate('win32')).toBeNull();
    expect(desktopApplicationMenuTemplate('linux')).toBeNull();
  });

  it('preserves standard macOS roles without installing Electron View accelerators', () => {
    const template = desktopApplicationMenuTemplate('darwin');

    expect(template).toEqual([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]);
    expect(template).not.toContainEqual({ role: 'viewMenu' });
  });

  it('enables DevTools only for unpackaged development windows', () => {
    expect(shouldEnableDesktopDevTools(false)).toBe(true);
    expect(shouldEnableDesktopDevTools(true)).toBe(false);
  });

  it('installs an explicit application-menu policy before Electron is ready', () => {
    const main = mainProcessSource();
    const installPolicy = main.indexOf('installApplicationMenu();');

    expect(installPolicy).toBeGreaterThan(-1);
    expect(installPolicy).toBeLessThan(main.indexOf('.whenReady()'));
    expect(main).toContain(
      'Menu.setApplicationMenu(template === null ? null : Menu.buildFromTemplate(template))',
    );
  });

  it('uses an explicit packaged DevTools policy when creating the main window', () => {
    expect(mainProcessSource()).toContain('devTools: shouldEnableDesktopDevTools(app.isPackaged)');
  });
});
