import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-545: the Windows installer always installs for the current user, so
// updates install on quit without an administrator prompt.

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Windows install mode (ADR-545)', () => {
  it('forces a current-user install from the shared installer hook', () => {
    const hook = repoFile('scripts/nsis-file-associations.nsh');
    expect(hook).toMatch(
      /^!macro customInstallMode\r?\n {2}StrCpy \$isForceCurrentInstall "1"\r?\n!macroend$/m,
    );
    expect(hook).not.toContain('isForceMachineInstall');
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
    const require = createRequire(import.meta.url);
    const builderRequire = createRequire(require.resolve('electron-builder'));
    const builderRoot = dirname(builderRequire.resolve('app-builder-lib/package.json'));
    const page = readFileSync(join(builderRoot, 'templates/nsis/multiUserUi.nsh'), 'utf8');
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
