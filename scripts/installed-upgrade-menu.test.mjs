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

test(
  'native file commands use direct or overflow controls without bypassing invocation safety',
  { skip: process.platform !== 'win32' },
  () => {
    const helper = fileURLToPath(new URL('./installed-upgrade-controls.ps1', import.meta.url));
    const command = `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. '${helper.replaceAll("'", "''")}'
function Assert-UpgradeApp { if (-not $script:owned) { throw 'Native UI process ownership changed.' } }
$script:upgradeApp = [pscustomobject]@{ Id = 8000 }; $script:upgradeWindow = [IntPtr]9000
function New-Control([string]$Kind, [bool]$Enabled, [bool]$Hidden) {
  $control = [pscustomobject]@{ Kind = $Kind; Current = [pscustomobject]@{ IsEnabled = $Enabled; IsOffscreen = $Hidden } }
  $control | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern, $Result)
    if ($Pattern -ne [Windows.Automation.ScrollItemPattern]::Pattern) { throw 'Wrong reveal pattern.' }
    $Result.Value = $script:scroll
    return $true
  }
  $control | Add-Member ScriptMethod GetCurrentPattern {
    param($Pattern)
    if ($this.Kind -eq 'trigger') {
      if ($Pattern -ne [Windows.Automation.ExpandCollapsePattern]::Pattern) { throw 'Wrong trigger pattern.' }
      return $script:expand
    }
    if ($Pattern -ne [Windows.Automation.InvokePattern]::Pattern) { throw 'Wrong invocation pattern.' }
    $script:invokedKind = $this.Kind
    return $script:invoke
  }
  return $control
}
function Get-UpgradeControl {
  param([string]$Name, [string]$Role = 'Button', $Parent, [switch]$Prefix, [int]$TimeoutSeconds = 30, [switch]$Optional, [switch]$IncludeOffscreen)
  Assert-UpgradeApp
  if ($null -ne $Parent) { throw 'Unexpected foreign parent.' }
  $script:queries.Add(@{ name = $Name; role = $Role; optional = [bool]$Optional; timeout = $TimeoutSeconds; prefix = [bool]$Prefix; hidden = [bool]$IncludeOffscreen })
  if ($Name -eq 'More commands' -and $Role -eq 'Button') {
    $control = $script:trigger
  } elseif ($Name -eq $script:name -and $Role -eq 'Button') {
    if ($script:case -eq 'ambiguous-direct') { throw 'Ambiguous native control.' }
    $control = $script:direct
    if ($script:case -eq 'owner-after-direct-query' -and -not $Optional) { $script:owned = $false }
  } elseif ($Name -eq $script:name -and $Role -eq 'MenuItem') {
    if (-not $Prefix) { throw 'Menu item must allow shortcut suffix.' }
    if ($script:expanded -ne 1) { throw 'Overflow menu was not expanded.' }
    if ($script:case -eq 'ambiguous-item') { throw 'Ambiguous native control.' }
    $control = $script:item
  } else { throw 'Wrong selector.' }
  if ($null -eq $control -or ($control.Current.IsOffscreen -and -not $IncludeOffscreen)) {
    if ($Optional) { return $null }
    throw "Native control did not appear: $Role $Name"
  }
  return $control
}
$reports = foreach ($name in @('Open...', 'Import...', 'Save As...')) {
  foreach ($case in @('current-overflow', 'historical-direct', 'current-direct', 'historical-overflow', 'disabled-direct', 'disabled-trigger', 'disabled-item', 'missing-command', 'still-hidden', 'owner-after-direct-query', 'owner-after-expand', 'owner-after-scroll', 'disabled-after-scroll', 'ambiguous-direct', 'ambiguous-item')) {
    $script:name = $name; $script:case = $case; $script:owned = $true
    $script:invoked = 0; $script:expanded = 0; $script:reveals = 0; $script:invokedKind = ''
    $script:queries = [Collections.Generic.List[object]]::new()
    $script:direct = $null
    if ($case -in @('historical-direct', 'current-direct', 'disabled-direct', 'owner-after-direct-query', 'ambiguous-direct')) {
      $script:direct = New-Control 'direct' ($case -ne 'disabled-direct') $false
    }
    $script:trigger = New-Control 'trigger' ($case -ne 'disabled-trigger') $false
    $script:item = New-Control 'item' ($case -ne 'disabled-item') ($case -ne 'historical-overflow')
    if ($case -eq 'missing-command') { $script:item = $null }
    $script:scroll = [pscustomobject]@{}
    $script:scroll | Add-Member ScriptMethod ScrollIntoView {
      $script:reveals++
      if ($script:case -ne 'still-hidden') { $script:item.Current.IsOffscreen = $false }
      if ($script:case -eq 'owner-after-scroll') { $script:owned = $false }
      if ($script:case -eq 'disabled-after-scroll') { $script:item.Current.IsEnabled = $false }
    }
    $script:invoke = [pscustomobject]@{}
    $script:invoke | Add-Member ScriptMethod Invoke { $script:invoked++ }
    $script:expand = [pscustomobject]@{}
    $script:expand | Add-Member ScriptMethod Expand {
      $script:expanded++
      if ($script:case -eq 'owner-after-expand') { $script:owned = $false }
    }
    $failure = $null
    try { Invoke-UpgradeFileCommand $name } catch { $failure = $_.ToString() }
    @{ name = $name; case = $case; error = $failure; invoked = $script:invoked; kind = $script:invokedKind; expanded = $script:expanded; reveals = $script:reveals; queries = @($script:queries) }
  }
}
$reports | ConvertTo-Json -Depth 6 -Compress
`;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', timeout: 30_000, windowsHide: true },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const reports = JSON.parse(result.stdout);
    assert.equal(reports.length, 45);
    for (const report of reports) {
      const label = `${report.name} ${report.case}`;
      const direct = ['historical-direct', 'current-direct'].includes(report.case);
      const overflow = ['historical-overflow', 'current-overflow'].includes(report.case);
      if (direct || overflow) {
        assert.equal(report.error, null, `${label}: ${report.error}`);
        assert.equal(report.invoked, 1, label);
        assert.equal(report.kind, direct ? 'direct' : 'item', label);
        assert.equal(report.expanded, direct ? 0 : 1, label);
        assert.equal(report.reveals, report.case === 'current-overflow' ? 1 : 0, label);
        const probe = report.queries[0];
        assert.equal(probe.role, 'Button', label);
        assert.equal(probe.optional, true, label);
        assert.equal(probe.hidden, false, label);
        assert.ok(probe.timeout >= 0 && probe.timeout <= 2, label);
      } else {
        const expectedError = report.case.startsWith('ambiguous')
          ? /Ambiguous native control/
          : report.case.startsWith('owner')
            ? /Native UI process ownership changed/
            : report.case.startsWith('disabled')
              ? /Native control is disabled/
              : /Native control did not appear/;
        assert.match(report.error ?? '', expectedError, label);
        assert.equal(report.invoked, 0, label);
        if (
          [
            'disabled-direct',
            'owner-after-direct-query',
            'ambiguous-direct',
            'disabled-trigger',
          ].includes(report.case)
        ) {
          assert.equal(report.expanded, 0, label);
        }
      }
    }
  },
);
