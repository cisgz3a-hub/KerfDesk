import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_PROJECT_EXTENSIONS } from './desktop-project-paths';

const BUILDER_CONFIGS = ['electron-builder.yml', 'electron-builder.preview.yml'];

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

/** The top-level `fileAssociations` list: its indented lines, and nothing after. */
function associationBlock(config: string): string {
  const match = /^fileAssociations:\r?\n((?: {2}.*\r?\n)+)/m.exec(config);
  if (match?.[1] === undefined) throw new Error('fileAssociations is missing');
  return match[1];
}

describe('desktop project file association (ADR-378)', () => {
  it.each(BUILDER_CONFIGS)('%s associates KerfDesk projects with the app', (file) => {
    const block = associationBlock(repoFile(file));

    expect([...block.matchAll(/- ext: /g)]).toHaveLength(1);
    expect(block).toMatch(/^ {2}- ext: lf2$/m);
    expect(block).toMatch(/^ {4}name: KerfDesk\.Project$/m);
    expect(block).toMatch(/^ {4}description: KerfDesk project$/m);
  });

  it.each(BUILDER_CONFIGS)('%s leaves LightBurn files associated with LightBurn', (file) => {
    expect(associationBlock(repoFile(file))).not.toMatch(/lbrn/i);
  });

  it('opens the associated type when the operating system launches the app with it', () => {
    expect(DESKTOP_PROJECT_EXTENSIONS.has('.lf2')).toBe(true);
  });

  it.each(BUILDER_CONFIGS)('%s repairs the installed open verb with quoted paths', (file) => {
    expect(repoFile(file)).toMatch(
      /^nsis:\r?\n {2}include: scripts\/nsis-file-associations\.nsh$/m,
    );
    const hook = repoFile('scripts/nsis-file-associations.nsh');
    expect(hook).toContain(
      String.raw`WriteRegStr SHELL_CONTEXT "Software\Classes\KerfDesk.Project\shell\open\command" "" '"$appExe" "%1"'`,
    );
    expect(hook).not.toMatch(/(?:HKCU|HKLM|SetShellVarContext|DeleteReg)/);
    expect(hook).toContain('!insertmacro UPDATEFILEASSOC');
  });

  it('the installed builder runs our hook after registration in the existing shell context', () => {
    const require = createRequire(import.meta.url);
    const builderRequire = createRequire(require.resolve('electron-builder'));
    const builderRoot = dirname(builderRequire.resolve('app-builder-lib/package.json'));
    const templates = join(builderRoot, 'templates/nsis');
    const section = readFileSync(join(templates, 'installSection.nsh'), 'utf8');
    const registration = section.indexOf('!insertmacro registerFileAssociations');
    const customInstall = section.indexOf('!insertmacro customInstall');
    expect(registration).toBeGreaterThan(-1);
    expect(customInstall).toBeGreaterThan(registration);
    expect(section.slice(registration, customInstall)).not.toContain('SetShellVarContext');
    const associations = readFileSync(join(templates, 'include/FileAssociation.nsh'), 'utf8');
    expect(associations).toContain('WriteRegStr SHELL_CONTEXT');
    expect(associations).toContain('!macro UPDATEFILEASSOC');
  });
});
