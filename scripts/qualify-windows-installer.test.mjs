import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./qualify-windows-installer.ps1', import.meta.url));

test(
  'strict native selectors ignore unsupported descendants without accepting wrong roles or ambiguous owners',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const helper = fileURLToPath(new URL('./installed-upgrade-controls.ps1', import.meta.url));
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    const command = `
Set-StrictMode -Version Latest
. ${quoted(helper)}
function Assert-UpgradeApp {}
function Get-UpgradeWindowElement([IntPtr]$Window) { return $script:root }
function New-Control([string]$Name, [string]$Role, [bool]$Offscreen = $false) {
  $type = $(if ($Role) { [Windows.Automation.ControlType]::$Role } else { $null })
  return [pscustomobject]@{ RoleId = $(if ($type) { $type.Id } else { 0 }); Current = [pscustomobject]@{ Name = $Name; ControlType = $type; IsOffscreen = $Offscreen; IsEnabled = $true } }
}
$script:upgradeApp = [pscustomobject]@{ Id = 8000 }; $script:upgradeWindow = [IntPtr]9000
$unsupported = New-Control 'Unsupported provider element' ''
$wrongRole = New-Control 'Edit' 'Button'
$edit = New-Control 'Edit' 'MenuItem'
$hiddenEdit = New-Control 'Edit' 'MenuItem' $true
$unnamed = New-Control '' 'MenuItem'
$unnamed.Current.Name = $null
$settings = New-Control ('Settings... ' + [char]9 + 'Ctrl+,') 'MenuItem'
$reports = foreach ($case in @(
  @{ label = 'mixed-provider'; name = 'Edit'; prefix = $false; pid = 8000; controls = @($unsupported, $wrongRole, $edit, $hiddenEdit) },
  @{ label = 'shortcut-name'; name = 'Settings...'; prefix = $true; pid = 8000; controls = @($unsupported, $unnamed, $settings) },
  @{ label = 'wrong-role-only'; name = 'Edit'; prefix = $false; pid = 8000; controls = @($unsupported, $wrongRole) },
  @{ label = 'ambiguous'; name = 'Edit'; prefix = $false; pid = 8000; controls = @($unsupported, $edit, (New-Control 'Edit' 'MenuItem')) },
  @{ label = 'foreign-root'; name = 'Edit'; prefix = $false; pid = 9001; controls = @($edit) }
)) {
  $script:queries = [Collections.Generic.List[int]]::new()
  $script:root = [pscustomobject]@{ Current = [pscustomobject]@{ ProcessId = $case.pid }; Controls = $case.controls }
  $script:root | Add-Member -MemberType ScriptMethod -Name FindAll -Value {
    param($Scope, $Condition)
    if ($Scope -ne [Windows.Automation.TreeScope]::Descendants) { throw 'Selector escaped descendant scope.' }
    if ($Condition -eq [Windows.Automation.Condition]::TrueCondition) { return $this.Controls }
    if ($Condition -isnot [Windows.Automation.PropertyCondition] -or $Condition.Property -ne [Windows.Automation.AutomationElement]::ControlTypeProperty) { throw 'Unexpected native condition.' }
    $script:queries.Add([int]$Condition.Value)
    return @($this.Controls | Where-Object { $_.RoleId -eq $Condition.Value })
  }
  try {
    # A supplied dialog exercises the same selector without depending on an OS HWND.
    $parent = $(if ($case.label -eq 'foreign-root') { $null } else { $script:root })
    $control = Get-UpgradeControl $case.name 'MenuItem' $parent -Prefix:$case.prefix -TimeoutSeconds 0 -Optional
    @{ label = $case.label; passed = $true; found = $null -ne $control; name = $(if ($control) { $control.Current.Name } else { $null }); queries = @($script:queries) }
  } catch { @{ label = $case.label; passed = $false; error = $_.ToString(); queries = @($script:queries) } }
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
    const [mixed, shortcut, missing, ambiguous, foreign] = JSON.parse(result.stdout);
    assert.equal(mixed.passed, true, mixed.error);
    assert.equal(mixed.name, 'Edit');
    assert.deepEqual(mixed.queries, [50011]);
    assert.equal(shortcut.passed, true, shortcut.error);
    assert.match(shortcut.name, /^Settings\.\.\.\s+Ctrl\+,/u);
    assert.equal(missing.passed, true, missing.error);
    assert.equal(missing.found, false, 'a same-name button cannot satisfy a menu-item selector');
    assert.equal(ambiguous.passed, false);
    assert.match(ambiguous.error, /Ambiguous native control/u);
    assert.equal(foreign.passed, false);
    assert.match(foreign.error, /another PID/u);
    assert.deepEqual(foreign.queries, [], 'reject a foreign root before querying descendants');
  },
);

test(
  'native value readback waits for a delayed provider but rejects lost input, disabled controls and ownership changes',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const helper = fileURLToPath(new URL('./installed-upgrade-controls.ps1', import.meta.url));
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    const command = `
Set-StrictMode -Version Latest
. ${quoted(helper)}
function Assert-UpgradeApp { if (-not $script:state.owned) { throw 'Native UI process ownership changed.' } }
function Get-UpgradeControl([string]$Name, [string]$Role, $Parent = $null) { return $script:control }
$reports = foreach ($case in @(
  @{ label = 'immediate'; delayReads = 0; enabled = $true; changeOwner = $false },
  @{ label = 'delayed'; delayReads = 2; enabled = $true; changeOwner = $false },
  @{ label = 'lost-input'; delayReads = 100000; enabled = $true; changeOwner = $false },
  @{ label = 'disabled'; delayReads = 0; enabled = $false; changeOwner = $false },
  @{ label = 'ownership-changed'; delayReads = 0; enabled = $true; changeOwner = $true }
)) {
  $script:state = @{ owned = $true; reads = 0; setCount = 0; focusCount = 0; expected = ''; delayReads = $case.delayReads; changeOwner = $case.changeOwner }
  $value = [pscustomobject]@{}
  $value | Add-Member -MemberType ScriptProperty -Name Value -Value {
    $script:state.reads++
    if ($script:state.reads -le $script:state.delayReads) { return '10' }
    return $script:state.expected
  }
  $script:pattern = [pscustomobject]@{ Current = $value }
  $script:pattern | Add-Member -MemberType ScriptMethod -Name SetValue -Value {
    param($Value)
    $script:state.setCount++; $script:state.expected = $Value
    if ($script:state.changeOwner) { $script:state.owned = $false }
  }
  $script:control = [pscustomobject]@{ Current = [pscustomobject]@{ IsEnabled = $case.enabled } }
  $script:control | Add-Member -MemberType ScriptMethod -Name SetFocus -Value { $script:state.focusCount++ }
  $script:control | Add-Member -MemberType ScriptMethod -Name GetCurrentPattern -Value {
    param($Pattern)
    if ($Pattern -ne [Windows.Automation.ValuePattern]::Pattern) { throw 'Unexpected value pattern.' }
    return $script:pattern
  }
  try {
    Set-UpgradeValue 'Recent projects to keep' 'Spinner' '17'
    @{ label = $case.label; passed = $true; reads = $script:state.reads; setCount = $script:state.setCount; focusCount = $script:state.focusCount }
  } catch { @{ label = $case.label; passed = $false; error = $_.ToString(); reads = $script:state.reads; setCount = $script:state.setCount; focusCount = $script:state.focusCount } }
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
    const [immediate, delayed, lost, disabled, foreign] = JSON.parse(result.stdout);
    assert.equal(immediate.passed, true, immediate.error);
    assert.equal(immediate.reads, 1);
    assert.equal(delayed.passed, true, delayed.error);
    assert.equal(delayed.reads, 3);
    assert.equal(delayed.setCount, 1, 'a stale read must not repeat the user edit');
    assert.equal(lost.passed, false);
    assert.match(lost.error, /Native value did not read back/u);
    assert.equal(disabled.passed, false);
    assert.match(disabled.error, /disabled/u);
    assert.equal(disabled.setCount, 0);
    assert.equal(disabled.focusCount, 0);
    assert.equal(foreign.passed, false);
    assert.match(foreign.error, /ownership changed/u);
    assert.equal(foreign.reads, 0, 'stop reading immediately when the process owner changes');
  },
);

test(
  'native ownership keeps the original HWND through transient panes and rejects dead, foreign or recycled owners',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const helper = fileURLToPath(new URL('./installed-upgrade-controls.ps1', import.meta.url));
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    const command = `
. ${quoted(helper)}
function Get-UpgradeWindowElement([IntPtr]$Window) {
  $script:observedHandles.Add($Window.ToInt64())
  if ($script:currentCase.dead) { throw 'The original HWND no longer exists.' }
  if ($script:currentCase.missing) { return $null }
  return [pscustomobject]@{ Current = [pscustomobject]@{ ProcessId = $script:currentCase.pid; Name = ('KerfDesk ' + [char]0x2014 + ' retained.lf2'); ControlType = [pscustomobject]@{ ProgrammaticName = $script:currentCase.role } } }
}
$started = [DateTime]::Parse('2026-10-01T00:00:00Z').ToUniversalTime()
$reports = foreach ($case in @(
  @{ label = 'normal'; pid = 8000; role = 'ControlType.Window'; dead = $false; missing = $false; recycled = $false; foreignExe = $false; exited = $false; reportedHandle = 9000 },
  @{ label = 'transient-pane'; pid = 8000; role = 'ControlType.Window'; dead = $false; missing = $false; recycled = $false; foreignExe = $false; exited = $false; reportedHandle = 40000 },
  @{ label = 'dead'; pid = 8000; role = 'ControlType.Window'; dead = $true; missing = $false; recycled = $false; foreignExe = $false; exited = $false; reportedHandle = 40000 },
  @{ label = 'missing'; pid = 8000; role = 'ControlType.Window'; dead = $false; missing = $true; recycled = $false; foreignExe = $false; exited = $false; reportedHandle = 40000 },
  @{ label = 'foreign-pid'; pid = 9001; role = 'ControlType.Window'; dead = $false; missing = $false; recycled = $false; foreignExe = $false; exited = $false; reportedHandle = 40000 },
  @{ label = 'tracked-pane'; pid = 8000; role = 'ControlType.Pane'; dead = $false; missing = $false; recycled = $false; foreignExe = $false; exited = $false; reportedHandle = 40000 },
  @{ label = 'recycled'; pid = 8000; role = 'ControlType.Window'; dead = $false; missing = $false; recycled = $true; foreignExe = $false; exited = $false; reportedHandle = 40000 },
  @{ label = 'foreign-exe'; pid = 8000; role = 'ControlType.Window'; dead = $false; missing = $false; recycled = $false; foreignExe = $true; exited = $false; reportedHandle = 40000 },
  @{ label = 'exited'; pid = 8000; role = 'ControlType.Window'; dead = $false; missing = $false; recycled = $false; foreignExe = $false; exited = $true; reportedHandle = 40000 }
)) {
  $script:currentCase = $case
  $script:observedHandles = [Collections.Generic.List[long]]::new()
  $script:upgradeApp = [pscustomobject]@{ Id = 8000; HasExited = $case.exited; MainWindowHandle = [IntPtr]$case.reportedHandle; MainModule = [pscustomobject]@{ FileName = $(if ($case.foreignExe) { 'C:\\foreign\\KerfDesk.exe' } else { 'C:\\owned\\KerfDesk.exe' }) }; StartTime = $(if ($case.recycled) { $started.AddSeconds(1) } else { $started }) }
  $script:upgradeApp | Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
  $script:upgradeExecutable = 'C:\\owned\\KerfDesk.exe'; $script:upgradeStarted = $started; $script:upgradeWindow = [IntPtr]9000
  try { Assert-UpgradeApp; $titleMatches = (Get-UpgradeWindowTitle) -eq ('KerfDesk ' + [char]0x2014 + ' retained.lf2'); @{ label = $case.label; passed = $true; trackedTitleMatches = $titleMatches; observedHandles = @($script:observedHandles) } }
  catch { @{ label = $case.label; passed = $false; error = $_.ToString(); observedHandles = @($script:observedHandles) } }
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
    assert.equal(reports.length, 9);
    for (const success of reports.slice(0, 2)) {
      assert.equal(success.passed, true, success.label);
      assert.equal(success.trackedTitleMatches, true);
      assert.ok(success.observedHandles.length > 0);
      assert.ok(
        success.observedHandles.every((handle) => handle === 9000),
        'must never adopt a transient replacement HWND or its title',
      );
    }
    for (const rejected of reports.slice(2)) assert.equal(rejected.passed, false, rejected.label);
    for (const recycled of reports.slice(6))
      assert.deepEqual(recycled.observedHandles, [], 'reject process changes before touching UI');
  },
);

test(
  'pre-project machine verification supports legacy offers and automatic restore without masking corruption',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const helper = fileURLToPath(new URL('./installed-upgrade-controls.ps1', import.meta.url));
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    const command = `
. ${quoted(helper)}
function Get-UpgradeControl([string]$Name, [string]$Role, $Parent = $null, [switch]$Prefix, [int]$TimeoutSeconds = 30, [switch]$Optional) {
  if (-not $script:currentCase.owned) { throw 'Native UI process ownership changed.' }
  if ($Name -eq 'Import or draw artwork to create its first operation.') {
    $script:events.Add('verify-blank')
    if (-not $script:currentCase.blank) { throw 'Not a blank workspace before project open.' }
    return [pscustomobject]@{ name = $Name }
  }
  $script:events.Add('check-offer')
  if ($script:currentCase.offer) { return [pscustomobject]@{ name = $Name } }
  return $null
}
function Invoke-UpgradeControl([string]$Name, [string]$Role) { $script:events.Add('apply-offer') }
function Open-UpgradeMachine { $script:events.Add('open-machine'); return [pscustomobject]@{ name = 'Machine Setup' } }
function Read-UpgradeMachine($Machine) { $script:events.Add('read-machine'); return $script:currentCase.machine }
$fixture = [pscustomobject]@{ name = 'Upgrade retention fixture'; bedWidth = '321'; bedHeight = '234' }
$corrupt = [pscustomobject]@{ name = 'Upgrade retention fixture'; bedWidth = '320'; bedHeight = '234' }
$missing = [pscustomobject]@{ name = 'Generic starter'; bedWidth = '300'; bedHeight = '200' }
$reports = foreach ($case in @(
  @{ label = 'legacy'; offer = $true; machine = $fixture; blank = $true; owned = $true },
  @{ label = 'automatic'; offer = $false; machine = $fixture; blank = $true; owned = $true },
  @{ label = 'missing'; offer = $false; machine = $missing; blank = $true; owned = $true },
  @{ label = 'corrupt-legacy'; offer = $true; machine = $corrupt; blank = $true; owned = $true },
  @{ label = 'corrupt-automatic'; offer = $false; machine = $corrupt; blank = $true; owned = $true },
  @{ label = 'loaded-project'; offer = $false; machine = $fixture; blank = $false; owned = $true },
  @{ label = 'ownership-changed'; offer = $false; machine = $fixture; blank = $true; owned = $false }
)) {
  $script:currentCase = $case
  $script:events = [Collections.Generic.List[string]]::new()
  try {
    $restored = Read-RestoredUpgradeMachine
    @{ label = $case.label; passed = $true; path = $restored.restorePath; discard = $restored.needsScratchDiscard; values = $restored.values; events = @($script:events) }
  } catch { @{ label = $case.label; passed = $false; error = $_.ToString(); events = @($script:events) } }
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
    assert.equal(reports.length, 7);
    const [legacy, automatic, ...failures] = reports;
    assert.equal(legacy.path, 'legacy-offer');
    assert.equal(legacy.discard, true);
    assert.deepEqual(legacy.events, [
      'verify-blank',
      'check-offer',
      'apply-offer',
      'open-machine',
      'read-machine',
    ]);
    assert.equal(automatic.path, 'already-restored');
    assert.equal(automatic.discard, false);
    assert.deepEqual(automatic.events, [
      'verify-blank',
      'check-offer',
      'open-machine',
      'read-machine',
    ]);
    for (const failure of failures) assert.equal(failure.passed, false, failure.label);
    assert.match(failures[0].error, /Retained machine settings differ/u);
    assert.match(failures[1].error, /Retained machine settings differ/u);
    assert.match(failures[2].error, /Retained machine settings differ/u);
    assert.match(failures[3].error, /Not a blank workspace/u);
    assert.match(failures[4].error, /ownership changed/u);
  },
);

test(
  'sequential fresh and historical qualifications use distinct owned runner roots',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const helper = fileURLToPath(new URL('./installer-qualification-root.ps1', import.meta.url));
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    const runnerTemp = path.resolve(tmpdir());
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `. ${quoted(helper)}; @('Launch', 'HistoricalUpgrade', 'Full') | ForEach-Object { Get-InstallerQualificationRoot ${quoted(runnerTemp)} '123456' '2' $_ } | ConvertTo-Json -Compress`,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const roots = JSON.parse(result.stdout);
    assert.equal(
      new Set(roots).size,
      3,
      'Launch must not leave a root that blocks HistoricalUpgrade',
    );
    for (const root of roots)
      assert.equal(path.dirname(root).toLowerCase(), runnerTemp.toLowerCase());
  },
);

function rejectedRun(overrides, escapeEvidence = false, args = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'kerfdesk-installer-guard-'));
  const evidence = escapeEvidence
    ? path.join(root, '..', 'outside-evidence')
    : path.join(root, 'evidence');
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-Installer',
        path.join(root, 'nonexistent-N.exe'),
        '-UpgradeInstaller',
        path.join(root, 'nonexistent-N-plus-one.exe'),
        '-Version',
        '0.0.0-test.1',
        '-UpgradeVersion',
        '0.0.0-test.2',
        '-SourceCommit',
        'a'.repeat(40),
        '-EvidenceRoot',
        evidence,
        ...args,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
        env: {
          ...process.env,
          OS: 'Windows_NT',
          GITHUB_ACTIONS: 'false',
          RUNNER_ENVIRONMENT: '',
          RUNNER_TEMP: root,
          GITHUB_WORKSPACE: root,
          ...overrides,
        },
      },
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.equal(
      existsSync(path.join(root, 'evidence')),
      false,
      'must reject before creating evidence',
    );
    return `${result.stdout}\n${result.stderr}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  'installer qualification refuses a developer machine before any filesystem mutation',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(rejectedRun({}), /requires a disposable GitHub-hosted Windows runner/u);
  },
);

test(
  'installer qualification refuses persistent/self-hosted runners',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }),
      /requires a disposable/u,
    );
  },
);

test(
  'production qualification keeps the developer-machine refusal',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({}, false, ['-PackageKind', 'CommercialUnsigned', '-Scenario', 'Launch']),
      /requires a disposable GitHub-hosted Windows runner/u,
    );
  },
);

test(
  'production full qualification refuses unsupported CDP before mutation',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, false, [
        '-PackageKind',
        'CommercialUnsigned',
      ]),
      /Full requires CDP, which production packages forbid/u,
    );
  },
);

test(
  'installer qualification refuses a non-Windows runner',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ OS: 'Linux', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }),
      /requires a disposable/u,
    );
  },
);

test(
  'historical qualification cannot run on a developer machine',
  { skip: process.platform !== 'win32' },
  () => {
    assert.match(
      rejectedRun({}, false, [
        '-Scenario',
        'HistoricalUpgrade',
        '-PackageKind',
        'CommercialUnsigned',
        '-UpgradeSourceCommit',
        'b'.repeat(40),
      ]),
      /requires a disposable GitHub-hosted/,
    );
  },
);

test(
  'historical qualification refuses a same-source or unsupported-channel comparison before mutation',
  { skip: process.platform !== 'win32' },
  () => {
    for (const extra of [
      ['-PackageKind', 'CommercialUnsigned', '-UpgradeSourceCommit', 'a'.repeat(40)],
      ['-PackageKind', 'Preview', '-UpgradeSourceCommit', 'b'.repeat(40)],
    ]) {
      assert.match(
        rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, false, [
          '-Scenario',
          'HistoricalUpgrade',
          ...extra,
        ]),
        /distinct commercial versions and exact source commits/,
      );
    }
  },
);

test(
  'installer qualification rejects evidence paths outside the checked-out workspace',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    assert.match(
      rejectedRun({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, true),
      /outside its owned parent/u,
    );
  },
);

test(
  'normal-profile native driver refuses developer and self-hosted execution before mutation',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const driver = fileURLToPath(new URL('./installed-upgrade-profile.ps1', import.meta.url));
    const root = mkdtempSync(path.join(tmpdir(), 'kerfdesk-profile-guard-'));
    const evidence = path.join(root, 'evidence');
    try {
      for (const runner of [
        { GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: '' },
        { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' },
      ]) {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            driver,
            '-Phase',
            'create',
            '-Executable',
            path.join(root, 'missing.exe'),
            '-EvidenceRoot',
            evidence,
            '-ExpectedProfile',
            path.join(root, 'profile'),
            '-Project',
            path.join(root, 'missing.lf2'),
            '-ExpectedVersion',
            '1.0.2',
            '-ExpectedCommit',
            'a'.repeat(40),
          ],
          {
            encoding: 'utf8',
            timeout: 30_000,
            windowsHide: true,
            env: {
              ...process.env,
              OS: 'Windows_NT',
              RUNNER_TEMP: root,
              GITHUB_WORKSPACE: root,
              ...runner,
            },
          },
        );
        assert.ifError(result.error);
        assert.notEqual(result.status, 0);
        assert.match(
          `${result.stdout}\n${result.stderr}`,
          /requires a disposable GitHub-hosted Windows runner/u,
        );
        assert.equal(existsSync(evidence), false);
        assert.equal(existsSync(path.join(root, 'profile')), false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
