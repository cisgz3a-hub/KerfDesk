import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-545: the Windows installer installs for the current user, so updates
// install on quit without an administrator prompt. Amendment 1: a copy an
// earlier installer put in for everyone (and not for this user) is updated
// where it is, and the uninstaller keeps electron-builder's own choice.

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function builderTemplate(name: string): string {
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const builderRoot = dirname(builderRequire.resolve('app-builder-lib/package.json'));
  return readFileSync(join(builderRoot, 'templates/nsis', name), 'utf8');
}

describe('Windows install mode (ADR-545)', () => {
  it('installs for the current user unless only an all-users copy exists', () => {
    const hook = repoFile('scripts/nsis-file-associations.nsh');
    const macro = hook.slice(hook.indexOf('!macro customInstallMode'));
    expect(macro.slice(0, macro.indexOf('!macroend'))).toMatch(
      new RegExp(
        [
          '!macro customInstallMode',
          ' {2}!ifndef BUILD_UNINSTALLER',
          ' {4}\\$\\{If\\} \\$hasPerMachineInstallation == "1"',
          ' {4}\\$\\{AndIf\\} \\$hasPerUserInstallation == "0"',
          ' {6}StrCpy \\$isForceMachineInstall "1"',
          ' {4}\\$\\{Else\\}',
          ' {6}StrCpy \\$isForceCurrentInstall "1"',
          ' {4}\\$\\{EndIf\\}',
          ' {2}!endif',
          '',
        ].join('\\r?\\n'),
      ),
    );
  });

  // Amendment 1: electron-builder records an existing install's mode before the
  // page, from the same registry key a silent update reads.
  it('the builder finds existing installs before the hook runs', () => {
    const init = builderTemplate('assistedInstaller.nsh');
    const machine = init.indexOf(
      'ReadRegStr $perMachineInstallationFolder HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation',
    );
    const user = init.indexOf(
      'ReadRegStr $perUserInstallationFolder HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation',
    );
    expect(machine).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(machine);
    expect(init.slice(machine, user)).toContain('StrCpy $hasPerMachineInstallation "1"');
    const page = builderTemplate('multiUserUi.nsh');
    const hook = page.indexOf('!insertmacro customInstallMode');
    const perMachine = page.indexOf('${if} $isForceMachineInstall == "1"');
    const perUser = page.indexOf('${if} $isForceCurrentInstall == "1"');
    expect(perMachine).toBeGreaterThan(hook);
    expect(perUser).toBeGreaterThan(perMachine);
    // Without a forced mode the uninstaller removes the one copy there is, or asks.
    const uninstaller = page.indexOf('!ifdef BUILD_UNINSTALLER', perUser);
    expect(uninstaller).toBeGreaterThan(perUser);
    expect(page.slice(uninstaller)).toContain('${andIf} $hasPerMachineInstallation == "1"');
  });

  it.each(['electron-builder.yml', 'electron-builder.preview.yml'])(
    '%s uses the assisted per-user installer with that hook',
    (file) => {
      const config = repoFile(file);
      expect(config).toMatch(/^ {2}include: scripts\/nsis-file-associations\.nsh$/m);
      expect(config).toMatch(/^ {2}oneClick: false$/m);
      expect(config).toMatch(/^ {2}perMachine: false$/m);
    },
  );

  it('the installed builder reads the hook before its install-mode choice', () => {
    const page = builderTemplate('multiUserUi.nsh');
    const reset = page.indexOf('StrCpy $isForceCurrentInstall "0"');
    const hook = page.indexOf('!insertmacro customInstallMode');
    const perUser = page.indexOf('${if} $isForceCurrentInstall == "1"');
    expect(reset).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(reset);
    expect(perUser).toBeGreaterThan(hook);
    // NSIS matches macro names without regard to case, so the builder's
    // `!ifmacrodef customInstallmode` finds this hook (checked with makensis 3.09).
    expect(page.slice(reset, hook).toLowerCase()).toContain('!ifmacrodef custominstallmode');
  });
});
