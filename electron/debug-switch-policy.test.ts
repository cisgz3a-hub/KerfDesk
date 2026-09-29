import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { refusedDebugSwitch } from './debug-switch-policy.js';

function check(
  argv: ReadonlyArray<string>,
  options: { readonly sellsLicences?: boolean } = {},
): string | null {
  const switches = new Set(
    argv.filter((value) => value.startsWith('--')).map((value) => value.slice(2).split('=')[0]),
  );
  return refusedDebugSwitch({
    sellsLicences: options.sellsLicences ?? true,
    argv: ['KerfDesk.exe', ...argv],
    hasSwitch: (name) => switches.has(name),
  });
}

describe('remote debugging in builds that sell licences (ADR-544)', () => {
  it('refuses the port and pipe switches', () => {
    expect(check(['--remote-debugging-port=9222'])).toBe('--remote-debugging-port');
    expect(check(['--remote-debugging-pipe'])).toBe('--remote-debugging-pipe');
  });

  it('refuses the other spellings Chromium accepts', () => {
    expect(check(['-remote-debugging-port=9222'])).toBe('-remote-debugging-port');
    expect(check(['/Remote-Debugging-Port=9222'])).toBe('/Remote-Debugging-Port');
    expect(check(['--remote-debugging-io-pipes=3,4'])).toBe('--remote-debugging-io-pipes');
  });

  it('allows an ordinary launch, including a project to open', () => {
    expect(check([])).toBeNull();
    expect(check(['C:\\Jobs\\sign.lf2'])).toBeNull();
  });

  it('leaves Preview, free and development builds alone', () => {
    expect(check(['--remote-debugging-port=9222'], { sellsLicences: false })).toBeNull();
  });

  // Amendment 1: on Windows `app.isPackaged` is false for any copy named electron.exe.
  it('locks down a build that sells licences whatever app.isPackaged says', () => {
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    expect(main).toContain('const LOCKED_DOWN = app.isPackaged || SELLS_LICENCES;');
    expect(main).toMatch(/refusedDebugSwitch\(\{\s*sellsLicences: SELLS_LICENCES,/);
    expect(main).toMatch(
      /resolveRendererRuntime\(\{\s*devUrl: process\.env\['LASERFORGE_DEV_URL'\],\s*isPackaged: LOCKED_DOWN,\s*\}\)/,
    );
    expect(main).toContain('shouldEnableDesktopDevTools(LOCKED_DOWN)');
    expect(main).toMatch(
      /function installDevTools\(window: BrowserWindow\): void \{\s*if \(LOCKED_DOWN\) return;/,
    );
    expect(main).not.toMatch(
      /shouldEnableDesktopDevTools\(app\.isPackaged\)|if \(app\.isPackaged\) return;/,
    );
  });

  it('is checked before the app registers its renderer or opens a window', () => {
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const check = main.indexOf('refusedDebugSwitch(');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(main.indexOf('installDesktopProjectOpens(app'));
    expect(main).toContain('HAS_SINGLE_INSTANCE_LOCK && REFUSED_DEBUG_SWITCH === null');
  });
});
