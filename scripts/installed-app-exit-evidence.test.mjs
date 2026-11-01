import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Rolling audit v8 N7-P3-2: a qualification close that exits non-zero keeps
// how it ended, so a native crash at shutdown can be told from a clean code.
test(
  'a non-zero close keeps its exit code in decimal and hex and the app evidence, and still fails',
  { skip: process.platform !== 'win32' },
  () => {
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    const driver = fileURLToPath(new URL('./installed-upgrade-profile.ps1', import.meta.url));
    const helper = fileURLToPath(new URL('./installed-app-exit-evidence.ps1', import.meta.url));
    const root = mkdtempSync(path.join(tmpdir(), 'kerfdesk-exit-evidence-'));
    const profile = path.join(root, 'profile');
    mkdirSync(path.join(profile, 'logs'), { recursive: true });
    const started = (version) =>
      `INFO  [app] KerfDesk ${version} started (installed build) on Windows 10.0.26100 x64.`;
    // More than the 64 KB tail, so the copy must start on a whole line.
    const filler = Array.from(
      { length: 800 },
      (_, line) => `2026-10-29T09:00:00.000Z INFO  [main] filler ${line} ${'x'.repeat(80)}`,
    );
    writeFileSync(
      path.join(profile, 'logs', 'kerfdesk.log'),
      [
        ...filler,
        `2026-10-29T09:08:00.000Z ${started('1.0.28')}`,
        '2026-10-29T09:08:40.000Z INFO  [app] KerfDesk quit.',
        `2026-10-29T09:09:00.000Z ${started('1.0.28')}`,
        '2026-10-29T09:09:17.000Z WARN  [window] synthetic-licence-value reached a message.',
        '',
      ].join('\n'),
    );
    // Runs the driver's own close functions with a fake app and event log.
    // Nothing launches, and the real event log is never read.
    const command = `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. ${quoted(helper)}
$ast = [Management.Automation.Language.Parser]::ParseFile(${quoted(driver)}, [ref]$null, [ref]$null)
foreach ($name in @('Save-UpgradeAppExit', 'Close-UpgradeAppNormally')) {
  $definition = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true)
  . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert-UpgradeApp { }
function Get-WinEvent {
  [CmdletBinding()] param($FilterHashtable)
  $global:eventFilter = @{ logName = $FilterHashtable.LogName; providers = @($FilterHashtable.ProviderName); since = $FilterHashtable.StartTime.ToString('o') }
  if ($global:eventFailure) { throw 'synthetic event log failure' }
  [pscustomobject]@{ TimeCreated = [DateTime]::UtcNow; ProviderName = 'Application Error'; Id = 1000; Message = 'Faulting application name: KerfDesk.exe. Exception code: 0xc0000005' }
  [pscustomobject]@{ TimeCreated = [DateTime]::UtcNow; ProviderName = 'Application Error'; Id = 1000; Message = 'Faulting application name: another.exe' }
}
$Executable = 'C:\\owned\\KerfDesk Installed\\KerfDesk.exe'
$licenceKey = 'synthetic-licence-value'
$phaseStarted = [DateTime]::new(2026, 10, 29, 9, 8, 0, [DateTimeKind]::Utc)
$reports = foreach ($case in @(
  @{ name = 'crash'; code = -1073741819; profile = ${quoted(profile)}; eventFailure = $false },
  @{ name = 'clean'; code = 0; profile = ${quoted(profile)}; eventFailure = $false },
  @{ name = 'quiet'; code = 1; profile = ${quoted(path.join(root, 'missing-profile'))}; eventFailure = $true }
)) {
  $global:eventFilter = $null; $global:eventFailure = $case.eventFailure
  $ExpectedProfile = $case.profile
  $EvidenceRoot = Join-Path ${quoted(root)} ($PSVersionTable.PSEdition + '-' + $case.name)
  $receipt = [ordered]@{ status = 'running' }
  $app = [pscustomobject]@{ ExitCode = $case.code }
  $app | Add-Member ScriptMethod CloseMainWindow { $true }
  $app | Add-Member ScriptMethod WaitForExit { param($milliseconds) $true }
  $app | Add-Member ScriptMethod Refresh { }
  $message = $null
  try { Close-UpgradeAppNormally } catch { $message = $_.ToString() }
  @{ name = $case.name; message = $message; receipt = $receipt; filter = $global:eventFilter; evidence = $EvidenceRoot }
}
@{ reports = @($reports); breakpoint = (Format-InstalledAppExitCode -2147483645) } | ConvertTo-Json -Depth 8 -Compress
`;
    try {
      // The driver runs under Windows PowerShell 5.1; the parent under pwsh.
      for (const host of ['powershell.exe', 'pwsh']) {
        const result = spawnSync(host, ['-NoProfile', '-NonInteractive', '-Command', command], {
          encoding: 'utf8',
          timeout: 30_000,
          windowsHide: true,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, `${host}: ${result.stderr}`);
        const { reports, breakpoint } = JSON.parse(result.stdout);
        assert.equal(breakpoint, '0x80000003', host);
        const byName = Object.fromEntries(reports.map((report) => [report.name, report]));

        const crash = byName.crash;
        assert.equal(
          crash.message,
          'Owned app exited unsuccessfully: exit code -1073741819 (0xC0000005).',
          host,
        );
        assert.equal(crash.receipt.status, 'running', 'a non-zero exit never passes');
        assert.equal(crash.receipt.exitCode, -1073741819);
        assert.equal(crash.receipt.exitCodeHex, '0xC0000005');
        const log = crash.receipt.exitEvidence.supportLog;
        assert.equal(log.quitAfterLastStart, false, 'the last launch never reached will-quit');
        assert.ok(log.copiedBytes <= 65_536 && log.copiedBytes < log.totalBytes, host);
        const tail = readFileSync(path.join(crash.evidence, 'app-exit', log.file), 'utf8');
        assert.match(tail, /^2026-10-29T09:00:00\.000Z INFO {2}\[main\] filler \d+ x+\n/u);
        assert.ok(tail.endsWith('[removed] reached a message.\n'), host);
        assert.doesNotMatch(tail, /synthetic-licence-value/u);
        assert.deepEqual(crash.filter, {
          logName: 'Application',
          providers: ['Application Error', 'Windows Error Reporting'],
          since: '2026-10-29T09:08:00.0000000Z',
        });
        assert.equal(crash.receipt.exitEvidence.windowsErrorEvents.count, 1);
        const events = JSON.parse(
          readFileSync(
            path.join(crash.evidence, 'app-exit', 'windows-error-events.json'),
            'utf8',
          ).replace(/^\uFEFF/u, ''),
        );
        assert.equal(events.length, 1, host);
        assert.match(events[0].message, /KerfDesk\.exe\. Exception code: 0xc0000005/u);

        const clean = byName.clean;
        assert.equal(clean.message, null, host);
        assert.equal(clean.receipt.status, 'passed');
        assert.equal(clean.receipt.exitCode, 0);
        assert.equal(clean.receipt.exitCodeHex, '0x00000000');
        assert.equal('exitEvidence' in clean.receipt, false, 'a clean close collects nothing');

        // Evidence that cannot be read is noted; the exit failure is unchanged.
        const quiet = byName.quiet;
        assert.equal(quiet.message, 'Owned app exited unsuccessfully: exit code 1 (0x00000001).');
        assert.equal(quiet.receipt.exitEvidence.supportLog, 'not present');
        assert.match(
          quiet.receipt.exitEvidence.windowsErrorEventsError,
          /synthetic event log failure/u,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
