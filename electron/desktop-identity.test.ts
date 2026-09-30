import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_APP_USER_MODEL_ID,
  DESKTOP_PRODUCT_NAME,
  legacyDesktopDataPath,
  LEGACY_DESKTOP_DATA_DIRECTORY,
  desktopRuntimeIdentity,
} from './desktop-identity.js';

describe('desktop identity continuity', () => {
  it('uses public KerfDesk branding without renaming legacy storage', () => {
    expect(DESKTOP_PRODUCT_NAME).toBe('KerfDesk');
    expect(LEGACY_DESKTOP_DATA_DIRECTORY).toBe('laserforge');
    expect(legacyDesktopDataPath('app-data')).toBe(join('app-data', 'laserforge'));
  });

  it('pins both data paths before ready and uses the public window title', () => {
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const ready = main.indexOf('.whenReady()');
    expect(main.indexOf("app.setPath('userData', DESKTOP_DATA_PATH)")).toBeLessThan(ready);
    expect(main.indexOf("app.setPath('sessionData', DESKTOP_DATA_PATH)")).toBeLessThan(ready);
    expect(main).toContain(
      'const DESKTOP_DATA_PATH = NATIVE_SMOKE_CONFIG?.userDataPath ?? PROFILE_DATA_PATH',
    );
    expect(main).toContain('title: DESKTOP_PRODUCT_NAME');
  });

  it('isolates even a damaged sandbox package from the working profile and taskbar', () => {
    expect(desktopRuntimeIdentity('app-data', { channel: 'invalid', sandbox: true })).toEqual({
      name: 'KerfDesk Sandbox',
      appId: 'dev.kerfdesk.sandbox',
      dataPath: join('app-data', 'kerfdesk-sandbox'),
    });
    expect(desktopRuntimeIdentity('app-data', { channel: 'free' }).dataPath).toBe(
      join('app-data', 'laserforge'),
    );
  });

  it('runs under the same Windows app ID the installer gives its shortcuts', () => {
    for (const config of ['electron-builder.yml', 'electron-builder.preview.yml']) {
      const yaml = readFileSync(join(process.cwd(), config), 'utf8');
      expect(yaml, config).toMatch(new RegExp(`^appId: ${DESKTOP_APP_USER_MODEL_ID}$`, 'm'));
    }
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    expect(main).toContain('app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID)');
  });
});
