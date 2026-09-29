import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-555: the Windows installer and uninstaller never end a running KerfDesk,
// which may be streaming a job; they wait for it or ask the operator to close it.

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function hookMacro(): string {
  const hook = repoFile('scripts/nsis-file-associations.nsh');
  const start = hook.indexOf('!macro customCheckAppRunning');
  expect(start).toBeGreaterThan(-1);
  return hook.slice(start, hook.indexOf('!macroend', start));
}

function builderTemplate(file: string): string {
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const builderRoot = dirname(builderRequire.resolve('app-builder-lib/package.json'));
  return readFileSync(join(builderRoot, 'templates/nsis', file), 'utf8');
}

describe('a running KerfDesk during install or uninstall (ADR-555)', () => {
  it('never ends the running app', () => {
    const macro = hookMacro();
    expect(macro).not.toMatch(/KILL_PROCESS|taskkill|Stop-Process|TerminateProcess/i);
    // Only the builder's read-only process search is used.
    expect(macro).toContain('!insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0');
  });

  it('asks the operator to close it, and a silent install stops instead', () => {
    const macro = hookMacro();
    expect(macro).toMatch(
      /MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "[^"]+" \/SD IDCANCEL IDRETRY/,
    );
    expect(macro).toContain('stops a running job and asks about unsaved work');
    expect(macro).not.toContain('/SD IDOK');
  });

  it('waits a bounded minute for an app quitting for an update, then leaves the update', () => {
    const macro = hookMacro();
    const update = macro.slice(macro.indexOf('${If} ${isUpdated}'), macro.indexOf('${Else}'));
    expect(update).toContain('${If} $R1 >= 60');
    expect(update).toContain('Sleep 1000');
    expect(update.match(/SetErrorLevel 1\s+Quit/g)).toHaveLength(1);
    expect(macro.match(/SetErrorLevel 1\s+Quit/g)).toHaveLength(2);
  });

  it('replaces the installed builder check, whose helpers it still finds', () => {
    const check = builderTemplate('include/allowOnlyOneInstallerInstance.nsh');
    const wrapper = check.slice(check.indexOf('!macro CHECK_APP_RUNNING'));
    const custom = wrapper.indexOf('!ifmacrodef customCheckAppRunning');
    expect(custom).toBeGreaterThan(-1);
    expect(wrapper.indexOf('!insertmacro customCheckAppRunning')).toBeGreaterThan(custom);
    expect(wrapper.indexOf('!insertmacro customCheckAppRunning')).toBeLessThan(
      wrapper.indexOf('!insertmacro _CHECK_APP_RUNNING'),
    );
    // Both helpers are defined outside the block the custom check switches off.
    const guarded = check.indexOf('!ifmacrondef customCheckAppRunning');
    const guardEnd = check.indexOf('!endif', guarded);
    expect(guarded).toBeGreaterThan(-1);
    for (const helper of ['!macro IS_POWERSHELL_AVAILABLE', '!macro FIND_PROCESS _FILE _RETURN'])
      expect(check.indexOf(helper)).toBeGreaterThan(guardEnd);
    // The installer and the uninstaller both run the check.
    expect(builderTemplate('installSection.nsh')).toContain('!insertmacro CHECK_APP_RUNNING');
    expect(builderTemplate('uninstaller.nsh')).toContain('!insertmacro CHECK_APP_RUNNING');
  });
});
