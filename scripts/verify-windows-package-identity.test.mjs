import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const verifier = readFileSync(
  new URL('./verify-windows-package-identity.ps1', import.meta.url),
  'utf8',
);

test('checks the executable product and truthful author metadata', () => {
  assert.match(verifier, /\$expectedCompanyName = 'Johann Stolk'/);
  assert.match(verifier, /\$expectedProductName = 'KerfDesk'/);
  assert.match(verifier, /\$appFileDescription = 'KerfDesk'/);
  assert.match(verifier, /\$metadata\.description/);
  assert.doesNotMatch(verifier, /Web \+ Windows desktop/);
  assert.match(verifier, /\[ValidateSet\('App', 'Installer'\)\]/);
  assert.match(verifier, /\$copyrightSymbol = \[char\]0x00A9/);
  assert.match(
    verifier,
    /\$expectedLegalCopyright = "Copyright \$copyrightSymbol 2026 Johann Stolk"/,
  );
  assert.match(verifier, /\$versionInfo\.CompanyName/);
  assert.match(verifier, /\$versionInfo\.ProductName/);
  assert.match(verifier, /\$versionInfo\.FileDescription/);
  assert.match(verifier, /\$versionInfo\.LegalCopyright/);
  assert.doesNotMatch(verifier, /Get-AuthenticodeSignature/);
});

test(
  'checks complete PE metadata against current and historical source descriptions',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'kerfdesk-package-identity-'));
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const run = (executable, args) => {
      const result = spawnSync(executable, args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
      });
      assert.ifError(result.error);
      return result;
    };
    const git = (...args) => {
      const result = run('git', args);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const powershell = (command) =>
      run('pwsh', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ]);
    try {
      mkdirSync(join(root, 'scripts'));
      const script = join(root, 'scripts', 'verify-windows-package-identity.ps1');
      copyFileSync(new URL('./verify-windows-package-identity.ps1', import.meta.url), script);
      const previous = 'Historical Windows desktop description.';
      const current = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url)),
      ).description;
      const metadata = (description) =>
        writeFileSync(join(root, 'package.json'), JSON.stringify({ description }));
      metadata(previous);
      git('init', '--quiet');
      git('add', 'package.json');
      git(
        '-c',
        'user.name=Identity test',
        '-c',
        'user.email=identity@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'Historical metadata',
      );
      const source = git('rev-parse', 'HEAD');
      metadata(current);
      for (const [name, description] of [
        ['current', current],
        ['historical', previous],
      ]) {
        const assembly = `using System.Reflection;
[assembly: AssemblyCompany("Johann Stolk")]
[assembly: AssemblyProduct("KerfDesk")]
[assembly: AssemblyTitle(${JSON.stringify(description)})]
[assembly: AssemblyCopyright("Copyright \\u00a9 2026 Johann Stolk")]
public class IdentityFixture { }`;
        const sourceFile = join(root, `${name}.cs`);
        writeFileSync(sourceFile, assembly);
        // Framework csc emits actual VERSIONINFO resources; Add-Type on .NET Core
        // emits only managed attributes, which FileVersionInfo cannot inspect.
        const result = run(
          join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
          ['/nologo', '/target:library', `/out:${join(root, `${name}.dll`)}`, sourceFile],
        );
        assert.equal(result.status, 0, result.stderr);
      }
      const check = (name, expectedSource = '') =>
        powershell(
          `$ErrorActionPreference = 'Stop'; & ${quote(script)} -Executable ${quote(join(root, `${name}.dll`))} -Kind Installer ${expectedSource ? `-SourceCommit ${quote(expectedSource)}` : ''}`,
        );
      const currentResult = check('current');
      assert.equal(currentResult.status, 0, currentResult.stderr);
      const historicalResult = check('historical', source);
      assert.equal(historicalResult.status, 0, historicalResult.stderr);
      const wrong = check('historical');
      assert.notEqual(wrong.status, 0);
      assert.match(wrong.stderr, /FileDescription mismatch/);
      assert.notEqual(check('current', source).status, 0);
      assert.notEqual(check('current', 'main').status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
