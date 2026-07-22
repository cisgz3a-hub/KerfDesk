import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_PRODUCT_NAME,
  legacyDesktopDataPath,
  LEGACY_DESKTOP_DATA_DIRECTORY,
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
    expect(main.indexOf("app.setPath('userData', LEGACY_DESKTOP_DATA_PATH)")).toBeLessThan(ready);
    expect(main.indexOf("app.setPath('sessionData', LEGACY_DESKTOP_DATA_PATH)")).toBeLessThan(
      ready,
    );
    expect(main).toContain('title: DESKTOP_PRODUCT_NAME');
  });
});
