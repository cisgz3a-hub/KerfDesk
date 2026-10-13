import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test(
  'native Settings invocation reveals scrolled items without bypassing visible, enabled or ownership checks',
  { skip: process.platform !== 'win32' },
  () => {
    const helper = fileURLToPath(new URL('./installed-upgrade-controls.ps1', import.meta.url));
    const command = `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. '${helper.replaceAll("'", "''")}'
function Assert-UpgradeApp { if (-not $script:owned) { throw 'Native UI process ownership changed.' } }
function Get-UpgradeWindowElement([IntPtr]$Window) { return $script:root }
$script:upgradeApp = [pscustomobject]@{ Id = 8000 }; $script:upgradeWindow = [IntPtr]9000
function Get-UpgradeControl {
  param([string]$Name, [string]$Role, $Parent, [switch]$Prefix, [switch]$IncludeOffscreen)
  Assert-UpgradeApp
  $script:queries.Add([bool]$IncludeOffscreen)
  if ($Name -ne 'Settings...' -or $Role -ne 'MenuItem' -or -not $Prefix) { throw 'Wrong selector.' }
  if ($script:control.Current.IsOffscreen -and -not $IncludeOffscreen) { throw 'Native control did not appear.' }
  return $script:control
}
$reports = foreach ($case in @(
  @{ label = 'historical-visible'; offscreen = $false; scroll = $true; reveal = $true; enabled = $true; loseOwner = $false; disable = $false },
  @{ label = 'current-scroll'; offscreen = $true; scroll = $true; reveal = $true; enabled = $true; loseOwner = $false; disable = $false },
  @{ label = 'focus-fallback'; offscreen = $true; scroll = $false; reveal = $true; enabled = $true; loseOwner = $false; disable = $false },
  @{ label = 'still-hidden'; offscreen = $true; scroll = $true; reveal = $false; enabled = $true; loseOwner = $false; disable = $false },
  @{ label = 'disabled'; offscreen = $true; scroll = $true; reveal = $true; enabled = $false; loseOwner = $false; disable = $false },
  @{ label = 'owner-lost'; offscreen = $true; scroll = $true; reveal = $true; enabled = $true; loseOwner = $true; disable = $false },
  @{ label = 'disabled-after-scroll'; offscreen = $true; scroll = $true; reveal = $true; enabled = $true; loseOwner = $false; disable = $true }
)) {
  $script:case = $case; $script:owned = $true; $script:invoked = 0; $script:reveals = 0
  $script:queries = [Collections.Generic.List[bool]]::new()
  $script:control = [pscustomobject]@{ Current = [pscustomobject]@{ IsOffscreen = $case.offscreen; IsEnabled = $case.enabled } }
  $script:scroll = [pscustomobject]@{}
  $script:scroll | Add-Member ScriptMethod ScrollIntoView {
    $script:reveals++
    if ($script:case.reveal) { $script:control.Current.IsOffscreen = $false }
    if ($script:case.loseOwner) { $script:owned = $false }
    if ($script:case.disable) { $script:control.Current.IsEnabled = $false }
  }
  $script:invoke = [pscustomobject]@{}
  $script:invoke | Add-Member ScriptMethod Invoke { $script:invoked++ }
  $script:control | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern, $Result)
    if ($Pattern -ne [Windows.Automation.ScrollItemPattern]::Pattern) { throw 'Wrong reveal pattern.' }
    $Result.Value = $script:scroll
    return $script:case.scroll
  }
  $script:control | Add-Member ScriptMethod SetFocus { $script:scroll.ScrollIntoView() }
  $script:control | Add-Member ScriptMethod GetCurrentPattern {
    param($Pattern)
    if ($Pattern -ne [Windows.Automation.InvokePattern]::Pattern) { throw 'Wrong invocation pattern.' }
    return $script:invoke
  }
  try {
    Invoke-UpgradeControl 'Settings...' 'MenuItem' -Prefix -RevealOffscreen
    @{ label = $case.label; passed = $true; invoked = $script:invoked; reveals = $script:reveals; queries = @($script:queries) }
  } catch { @{ label = $case.label; passed = $false; invoked = $script:invoked; error = $_.ToString() } }
}
$reports | ConvertTo-Json -Depth 5 -Compress
`;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const reports = JSON.parse(result.stdout);
    for (const report of reports.slice(0, 3)) {
      assert.equal(report.passed, true, report.error);
      assert.equal(report.invoked, 1);
      assert.equal(report.reveals, report.label === 'historical-visible' ? 0 : 1);
      assert.deepEqual(
        report.queries,
        report.label === 'historical-visible' ? [true] : [true, false],
      );
    }
    for (const report of reports.slice(3)) {
      assert.equal(report.passed, false, report.label);
      assert.equal(report.invoked, 0, report.label);
    }
  },
);
