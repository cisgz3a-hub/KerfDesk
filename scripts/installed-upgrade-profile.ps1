param(
  [Parameter(Mandatory = $true)][ValidateSet('create', 'reopen')][string]$Phase,
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$EvidenceRoot,
  [Parameter(Mandatory = $true)][string]$ExpectedProfile,
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedCommit
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE) {
  throw 'Historical profile qualification requires a disposable GitHub-hosted Windows runner.'
}
function Assert-UpgradeChild([string]$Path, [string]$Parent) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $resolved.Contains('"')) {
    throw 'Historical qualification path escaped its owned parent.'
  }
  return $resolved
}
$Executable = Assert-UpgradeChild $Executable $env:RUNNER_TEMP
$Project = Assert-UpgradeChild $Project $env:RUNNER_TEMP
$EvidenceRoot = Assert-UpgradeChild $EvidenceRoot (Join-Path $env:GITHUB_WORKSPACE 'artifacts\installed-qualification')
if ($ExpectedCommit -notmatch '^[a-f0-9]{40}$' -or
    -not [string]::Equals([IO.Path]::GetFullPath($ExpectedProfile), (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'laserforge'), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Historical qualification needs the exact source and normal runner profile.'
}
if (Test-Path -LiteralPath $EvidenceRoot) { throw 'Historical phase evidence must be new.' }
New-Item -ItemType Directory -Path $EvidenceRoot | Out-Null
. (Join-Path $PSScriptRoot 'installed-upgrade-controls.ps1')
. (Join-Path $PSScriptRoot 'windows-powershell-process.ps1')
$app = $null
$receipt = [ordered]@{
  schemaVersion = 1; status = 'running'; startedAt = [DateTime]::UtcNow.ToString('o')
  phase = $Phase; expectedVersion = $ExpectedVersion; expectedCommit = $ExpectedCommit
  executable = $Executable; expectedProfile = $ExpectedProfile; project = $Project
  mode = 'normal installed launch, Windows accessibility and real native file dialogs; no CDP or smoke mode'
  limitations = @('Free licence state only; no paid credential is activated.', 'No hardware is connected or operated.')
}
function Write-UpgradeReceipt {
  $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'result.json') -Encoding utf8
}
function Invoke-UpgradeHelper([string]$Action, [string]$Label, [string]$FilePath = '', [string]$Command = '', [switch]$DiscardOwnedScratch) {
  $output = Join-Path $EvidenceRoot $Label
  New-Item -ItemType Directory -Path $output | Out-Null
  $arguments = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'installed-file-dialog.ps1'),
    '-Action', $Action, '-ExpectedExecutable', $Executable, '-EvidenceRoot', $output)
  if ($null -ne $app) { $arguments += @('-AppProcessId', [string]$app.Id) }
  if ($FilePath) { $arguments += @('-FilePath', $FilePath) }
  $info = New-QualificationWindowsPowerShell
  $info.UseShellExecute = $false; $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
  $info.Arguments = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $helper = [Diagnostics.Process]::Start($info)
  $stdout = $helper.StandardOutput.ReadToEndAsync(); $stderr = $helper.StandardError.ReadToEndAsync()
  try {
    if ($Command) { Invoke-UpgradeFileCommand $Command }
    if ($DiscardOwnedScratch) {
      if ($Action -ne 'Open' -or $Command -ne 'Open...' -or $Phase -ne 'reopen') {
        throw 'Scratch discard is restricted to reopening the retained fixture.'
      }
      # Applying the saved profile edits only this owned launch's blank project.
      # Explicitly discard that scratch edit before opening the retained file.
      $confirmation = Get-UpgradeControl 'Save changes?' 'Window'
      Invoke-UpgradeControl "Don't Save" 'Button' $confirmation
    }
    if (-not $helper.WaitForExit(65000)) { $helper.Kill(); throw "Native file helper timed out: $Label" }
    $helper.Refresh()
    $result = Get-Content -LiteralPath (Join-Path $output 'result.json') -Raw | ConvertFrom-Json
    if ($helper.ExitCode -ne 0 -or -not $result.ok) { throw "Native helper failed: $Label" }
    return $result
  } finally {
    if (-not $helper.HasExited) { $helper.Kill(); $helper.WaitForExit(10000) | Out-Null }
    $stdout.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $output 'stdout.txt') -Encoding utf8
    $stderr.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $output 'stderr.txt') -Encoding utf8
    $helper.Dispose()
  }
}
function Wait-UpgradeTitle([string]$File) {
  # Windows PowerShell 5.1 reads unmarked scripts as ANSI; build the Unicode
  # title separator explicitly so UTF-8 source is not misinterpreted.
  $expected = 'KerfDesk ' + [char]0x2014 + ' ' + [IO.Path]::GetFileName($File)
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Assert-UpgradeApp
    if ((Get-UpgradeWindowTitle) -eq $expected) { return }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Saved project was not reflected in the normal window title.'
}
Write-UpgradeReceipt
try {
  $receipt.preflight = Invoke-UpgradeHelper 'Preflight' 'preflight'
  if (-not $receipt.preflight.userInteractive -or $receipt.preflight.sessionId -eq 0 -or $receipt.preflight.existingProcesses.Count -ne 0) {
    throw 'Runner lacks an interactive desktop or already has a KerfDesk process.'
  }
  $ownerPath = Join-Path $ExpectedProfile '.kerfdesk-historical-upgrade-owner.json'
  if ($Phase -eq 'create') {
    if (Test-Path -LiteralPath $Project) { throw 'Refusing to overwrite a project.' }
    if ((Test-Path -LiteralPath $ExpectedProfile) -and @(Get-ChildItem -LiteralPath $ExpectedProfile -Force).Count) {
      throw 'Create requires an empty normal runner profile.'
    }
    New-Item -ItemType Directory -Path $ExpectedProfile -Force | Out-Null
    @{ runId = $env:GITHUB_RUN_ID; project = $Project } | ConvertTo-Json | Set-Content -LiteralPath $ownerPath -Encoding utf8
  } else {
    $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
    if ($owner.runId -ne $env:GITHUB_RUN_ID -or $owner.project -ne $Project) { throw 'Reopen profile is not owned by this run/project.' }
  }
  $info = [Diagnostics.ProcessStartInfo]::new($Executable)
  $info.UseShellExecute = $false; $info.CreateNoWindow = $false
  $info.Arguments = '--force-renderer-accessibility'
  $info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE'); $info.EnvironmentVariables.Remove('NODE_OPTIONS')
  # The actual GUI must be visible for native qualification; only helpers hide.
  $app = [Diagnostics.Process]::Start($info)
  Initialize-UpgradeControls $app $Executable
  $receipt.pid = $app.Id
  $build = Get-UpgradeControl 'Build version' 'Group'
  $null = Get-UpgradeControl $ExpectedVersion 'Text' $build
  $edition = Get-UpgradeControl 'Edition: Free' 'Button' -Prefix
  $receipt.freeLicenceObservation = $edition.Current.Name
  $receipt.initialWindow = Invoke-UpgradeHelper 'Inspect' 'initial-window'
  $settings = Open-UpgradeSettings
  if ($Phase -eq 'create') { Set-UpgradePreferences $settings }
  $receipt.preferences = Read-UpgradePreferences $settings
  Assert-UpgradePreferences $receipt.preferences
  Invoke-UpgradeControl 'Done' 'Button' $settings
  if ($Phase -eq 'create') {
    $machine = Open-UpgradeMachine
    Set-UpgradeMachine $machine
    $fixture = Join-Path $EvidenceRoot 'installed qualification artwork.svg'
    '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="12mm" viewBox="0 0 20 12"><path d="M0 0 H20 V12 H0 Z" fill="none" stroke="black"/></svg>' |
      Set-Content -LiteralPath $fixture -Encoding utf8
    $receipt.importDialog = Invoke-UpgradeHelper 'Open' 'import-dialog' $fixture 'Import...'
    $receipt.saveDialog = Invoke-UpgradeHelper 'Save' 'save-dialog' $Project 'Save As...'
    Wait-UpgradeTitle $Project
    $saved = $Project
  } else {
    # Accept the old restore offer only when present. Automatic restore leaves
    # no offer and no dirty scratch edit; exact pre-project values still must pass.
    $restored = Read-RestoredUpgradeMachine
    $receipt.machineRestorePath = $restored.restorePath
    $receipt.restoredProfileMachine = $restored.values
    $receipt.restoredProfileWindow = Invoke-UpgradeHelper 'Inspect' 'restored-profile-window'
    Invoke-UpgradeControl 'Cancel without saving' 'Button' $restored.window
    $receipt.openDialog = Invoke-UpgradeHelper 'Open' 'open-dialog' $Project 'Open...' -DiscardOwnedScratch:$restored.needsScratchDiscard
    $receipt.scratchDisposition = $(if ($restored.needsScratchDiscard) {
      'normal Don''t Save confirmation discarded only the restored-machine edit to the owned blank project'
    } else { 'already restored in the blank workspace; no scratch edit or discard' })
    Wait-UpgradeTitle $Project
    $saved = Join-Path $EvidenceRoot 'reopened-roundtrip.lf2'
    $receipt.saveDialog = Invoke-UpgradeHelper 'Save' 'save-dialog' $saved 'Save As...'
    Wait-UpgradeTitle $saved
  }
  & node (Join-Path $PSScriptRoot 'verify-upgrade-project.mjs') --expected-source $ExpectedCommit $saved $(if ($Phase -eq 'reopen') { $Project })
  if ($LASTEXITCODE -ne 0) { throw 'Saved project did not retain its scene or machine settings.' }
  $machine = Open-UpgradeMachine
  $receipt.machine = Read-UpgradeMachine $machine
  Assert-UpgradeMachine $receipt.machine
  Invoke-UpgradeControl 'Cancel without saving' 'Button' $machine
  $receipt.savedProject = @{ path = $saved; bytes = (Get-Item -LiteralPath $saved).Length; sha256 = (Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash.ToLowerInvariant() }
  $receipt.finalWindow = Invoke-UpgradeHelper 'Inspect' 'final-window'
  Assert-UpgradeApp
  if (-not $app.CloseMainWindow() -or -not $app.WaitForExit(30000)) { throw 'Owned app did not close normally after saving.' }
  $app.Refresh()
  if ($app.ExitCode -ne 0) { throw 'Owned app exited unsuccessfully.' }
  $receipt.exitCode = $app.ExitCode; $receipt.status = 'passed'
} catch {
  $receipt.status = 'failed'; $receipt.error = $_.ToString()
  throw
} finally {
  if ($null -ne $app) {
    $app.Refresh()
    if (-not $app.HasExited) {
      Assert-UpgradeApp
      $app.Kill(); $app.WaitForExit(10000) | Out-Null
      $receipt.failureCleanup = 'only the verified owned app PID was stopped'
    }
    $app.Dispose()
  }
  $receipt.finishedAt = [DateTime]::UtcNow.ToString('o'); Write-UpgradeReceipt
}
