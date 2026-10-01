param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$UpgradeInstaller,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$UpgradeVersion,
  [string]$UpgradeSourceCommit,
  [Parameter(Mandatory = $true)][string]$SourceCommit,
  [Parameter(Mandatory = $true)][string]$EvidenceRoot,
  # Full: the dry run's install, save/reopen, upgrade and uninstall qualification.
  # Launch: every pull request's install, packaged launch/import/save and
  # uninstall (ADR-522), with no upgrade candidate and no file dialogs.
  # HistoricalUpgrade: the actual published production installers, native UI
  # preferences/machine/file roundtrips, reinstall and retained user data.
  [ValidateSet('Full', 'Launch', 'HistoricalUpgrade')][string]$Scenario = 'Full',
  [ValidateSet('Preview', 'CommercialUnsigned')][string]$PackageKind = 'Preview'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Same-app NSIS installs share registry keys and may remove an existing install.
# Never run this exercise on a developer machine or a persistent/self-hosted runner.
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
    [string]::IsNullOrWhiteSpace($env:GITHUB_WORKSPACE)) {
  throw 'Installer qualification requires a disposable GitHub-hosted Windows runner.'
}
if ($SourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'Expected a full source commit.' }
if ($PackageKind -eq 'CommercialUnsigned' -and $Scenario -eq 'Full') {
  throw 'Full requires CDP, which production packages forbid. Use Launch or HistoricalUpgrade.'
}
if ($Scenario -in @('Full', 'HistoricalUpgrade') -and
    ([string]::IsNullOrWhiteSpace($UpgradeInstaller) -or [string]::IsNullOrWhiteSpace($UpgradeVersion))) {
  throw 'The full qualification needs an upgrade installer and version.'
}
if ($Scenario -eq 'HistoricalUpgrade' -and
    ($PackageKind -ne 'CommercialUnsigned' -or $UpgradeSourceCommit -notmatch '^[a-f0-9]{40}$' -or
     $UpgradeSourceCommit -eq $SourceCommit -or $UpgradeVersion -eq $Version)) {
  throw 'Historical qualification needs distinct commercial versions and exact source commits.'
}

function Assert-ChildPath([string]$Path, [string]$Parent) {
  $full = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside its owned parent: $full"
  }
  return $full
}

$Installer = Assert-ChildPath $Installer $env:GITHUB_WORKSPACE
if ($Scenario -in @('Full', 'HistoricalUpgrade')) { $UpgradeInstaller = Assert-ChildPath $UpgradeInstaller $env:GITHUB_WORKSPACE }
$EvidenceRoot = Assert-ChildPath $EvidenceRoot $env:GITHUB_WORKSPACE
. (Join-Path $PSScriptRoot 'installer-qualification-root.ps1')
$ownedRoot = Assert-ChildPath (Get-InstallerQualificationRoot $env:RUNNER_TEMP $env:GITHUB_RUN_ID $env:GITHUB_RUN_ATTEMPT $Scenario) $env:RUNNER_TEMP
$installRoot = Assert-ChildPath (Join-Path $ownedRoot 'KerfDesk Installed') $ownedRoot
$executable = Join-Path $installRoot 'KerfDesk.exe'
$uninstaller = Join-Path $installRoot 'Uninstall KerfDesk.exe'
$profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'laserforge'
$project = Join-Path $ownedRoot 'projects\real saved project.lf2'
$sentinel = Join-Path $profile 'installer-qualification-sentinel.json'
# Double-clicking a project opens KerfDesk (ADR-378); a per-user install registers it in HKCU.
$projectExtensionKey = 'HKCU:\Software\Classes\.lf2'
$projectClassKey = 'HKCU:\Software\Classes\KerfDesk.Project'
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'KerfDesk.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'KerfDesk.lnk')
)
$steps = [Collections.Generic.List[object]]::new()
$receipt = [ordered]@{
  schemaVersion = 1; status = 'running'; startedAt = [DateTime]::UtcNow.ToString('o')
  sourceCommit = $SourceCommit; runId = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT
  qualificationSourceCommit = $env:GITHUB_SHA; upgradeSourceCommit = $UpgradeSourceCommit
  runnerImage = $env:ImageOS; runnerImageVersion = $env:ImageVersion
  toolchain = @{
    node = (& node --version); pnpm = (& pnpm --version)
    electron = (Get-Content -LiteralPath (Join-Path $env:GITHUB_WORKSPACE 'node_modules\electron\package.json') -Raw | ConvertFrom-Json).version
    electronBuilder = (Get-Content -LiteralPath (Join-Path $env:GITHUB_WORKSPACE 'node_modules\electron-builder\package.json') -Raw | ConvertFrom-Json).version
    vitest = (Get-Content -LiteralPath (Join-Path $env:GITHUB_WORKSPACE 'node_modules\vitest\package.json') -Raw | ConvertFrom-Json).version
  }
  os = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture)
  elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  installRoot = $installRoot; profile = $profile; project = $project
  scenario = $Scenario; packageKind = $PackageKind; steps = $steps
  versions = @(if ($Scenario -in @('Full', 'HistoricalUpgrade')) { $Version, $UpgradeVersion } else { $Version })
  packaging = $(if ($PackageKind -eq 'CommercialUnsigned') {
    'Production unsigned Windows NSIS with pinned licence/release signatures and automatic updater disabled'
  } elseif ($Scenario -eq 'Full') {
    'electron-builder.yml Windows NSIS, unsigned with preview metadata and trusted updater disabled'
  } else { 'Windows NSIS, unsigned with preview metadata and trusted updater disabled' })
  limitations = @(
    $(if ($Scenario -in @('Full', 'HistoricalUpgrade')) {
      'Unsigned manual installer upgrade; production signed automatic updates remain unqualified.'
    } else {
      'Install, packaged launch/import/save on a throwaway profile, and uninstall only; no upgrade and no real file dialogs.'
    }),
    $(if ($Scenario -eq 'HistoricalUpgrade') {
      'Authenticated production baseline and exact-source upgrade candidate with a native-created Free profile; paid licensing state remains separate qualification.'
    } else { 'Both candidates use this same source commit; historical release/profile migrations remain separate checks.' }),
    'Hosted runner OS and account only; consumer Windows, standard-user UAC and SmartScreen remain separate checks.',
    'No physical controller, camera, laser, spindle or other hardware was operated.'
  )
}

function Write-Receipt {
  $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'qualification.json') -Encoding utf8
}

function Get-InstallRecords {
  foreach ($root in @('HKCU:\Software', 'HKLM:\Software', 'HKLM:\Software\WOW6432Node')) {
    $uninstallRoot = Join-Path $root 'Microsoft\Windows\CurrentVersion\Uninstall'
    if (-not (Test-Path -LiteralPath $uninstallRoot)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $uninstallRoot) {
      $entry = Get-ItemProperty -LiteralPath $key.PSPath
      if ($entry.PSObject.Properties['DisplayName'] -and $entry.DisplayName -match '^(KerfDesk|LaserForge)(\s|$)') {
        $identityKey = Join-Path $root $key.PSChildName
        $location = if (Test-Path -LiteralPath $identityKey) {
          (Get-ItemProperty -LiteralPath $identityKey).InstallLocation
        } else { $null }
        [pscustomobject]@{
          key = $key.Name; identityKey = $identityKey; displayName = $entry.DisplayName
          displayVersion = $entry.DisplayVersion; installLocation = $location
          uninstallString = $entry.UninstallString
        }
      }
    }
  }
}

function Get-Shortcuts {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($path in $shortcutPaths) {
    if (Test-Path -LiteralPath $path) {
      [pscustomobject]@{ path = $path; target = $shell.CreateShortcut($path).TargetPath }
    }
  }
}

function Get-ProjectAssociation {
  $command = Join-Path $projectClassKey 'shell\open\command'
  [pscustomobject]@{
    extensionClass = if (Test-Path -LiteralPath $projectExtensionKey) { (Get-Item -LiteralPath $projectExtensionKey).GetValue('') } else { $null }
    openCommand = if (Test-Path -LiteralPath $command) { (Get-Item -LiteralPath $command).GetValue('') } else { $null }
    classRegistered = Test-Path -LiteralPath $projectClassKey
  }
}

function Get-FileEvidence([string]$Path) {
  $file = Get-Item -LiteralPath $Path
  [pscustomobject]@{
    path = $file.FullName; bytes = $file.Length
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Invoke-BoundedProcess([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(180000)) {
    # Only this owned installer process tree is stopped; the VM retains failure evidence.
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    throw "Installer process timed out: $File"
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "Installer exit code $($process.ExitCode): $File" }
  return $process.ExitCode
}

function Assert-Installed([string]$ExpectedVersion, [string]$Candidate, [string]$ExpectedSourceCommit = $SourceCommit) {
  $records = @(Get-InstallRecords)
  if ($records.Count -ne 1 -or $records[0].key -notlike 'HKEY_CURRENT_USER\*' -or
      $records[0].displayVersion -ne $ExpectedVersion -or
      $records[0].installLocation.TrimEnd('\') -ne $installRoot) {
    throw "Unexpected per-user installation registration: $($records | ConvertTo-Json -Compress)"
  }
  if (-not (Test-Path -LiteralPath $executable) -or -not (Test-Path -LiteralPath $uninstaller)) {
    throw 'Installed application or uninstaller missing.'
  }
  & (Join-Path $PSScriptRoot 'verify-windows-package-identity.ps1') -Executable $executable | Out-Null
  $installedExecutable = Get-FileEvidence $executable
  $candidateExecutable = Get-FileEvidence (Join-Path (Split-Path -Parent $Candidate) 'win-unpacked\KerfDesk.exe')
  if ($installedExecutable.sha256 -ne $candidateExecutable.sha256) { throw 'Installed executable differs from packaged candidate.' }
  $installedAsar = Get-FileEvidence (Join-Path $installRoot 'resources\app.asar')
  $candidateAsar = Get-FileEvidence (Join-Path (Split-Path -Parent $Candidate) 'win-unpacked\resources\app.asar')
  if ($installedAsar.sha256 -ne $candidateAsar.sha256) { throw 'Installed ASAR differs from packaged candidate.' }
  if ($PackageKind -eq 'CommercialUnsigned') {
    $verifier = if ($Scenario -eq 'HistoricalUpgrade') { 'verify-historical-installed.mjs' } else { 'verify-installed-unsigned-commercial.mjs' }
    & node (Join-Path $PSScriptRoot $verifier) (Join-Path $installRoot 'resources') $ExpectedVersion $ExpectedSourceCommit | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Installed production signature/version/source/updater verification failed.' }
  } else {
    & node (Join-Path $PSScriptRoot 'verify-packaged-preview-metadata.mjs') $installedAsar.path $ExpectedVersion | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Installed Preview metadata/version/updater trust verification failed.' }
  }
  $shortcuts = @(Get-Shortcuts)
  if ($shortcuts.Count -ne 2 -or @($shortcuts | Where-Object target -NE $executable).Count -ne 0) {
    throw 'Expected desktop and Start Menu shortcuts to the installed executable.'
  }
  $association = Get-ProjectAssociation
  # Both the executable and document must be quoted; a custom NSIS hook fixes
  # electron-builder's unquoted executable when the install path contains spaces.
  $openCommand = "`"$executable`" `"%1`""
  if ($association.extensionClass -ne 'KerfDesk.Project' -or $association.openCommand -ne $openCommand) {
    throw "Expected .lf2 projects to open in the installed executable: $($association | ConvertTo-Json -Compress)"
  }
  return [pscustomobject]@{
    registry = $records; asar = $installedAsar; candidateAsar = $candidateAsar
    executable = $installedExecutable; candidateExecutable = $candidateExecutable
    shortcuts = $shortcuts; projectAssociation = $association
    previewMetadataVerified = ($PackageKind -eq 'Preview')
    commercialUnsignedMetadataVerified = ($PackageKind -eq 'CommercialUnsigned'); trustedUpdater = $false
  }
}

function Install-Candidate([string]$Label, [string]$Candidate, [string]$ExpectedVersion, [string]$ExpectedSourceCommit = $SourceCommit) {
  $started = [DateTime]::UtcNow
  # NSIS /D must be the final argument and is intentionally unquoted, including spaces.
  $exitCode = Invoke-BoundedProcess $Candidate "/S /currentuser /D=$installRoot"
  $state = Assert-Installed $ExpectedVersion $Candidate $ExpectedSourceCommit
  $steps.Add([pscustomobject]@{ name = $Label; exitCode = $exitCode; elapsedSeconds = ([DateTime]::UtcNow - $started).TotalSeconds; installed = $state })
  Write-Receipt
}

function Invoke-FileRoundtrip([string]$Label, [string]$Phase, [string]$ExpectedVersion) {
  $output = Join-Path $EvidenceRoot $Label
  New-Item -ItemType Directory -Path $output | Out-Null
  $startInfo = [Diagnostics.ProcessStartInfo]::new((Get-Command node).Source)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in @(
    (Join-Path $PSScriptRoot 'installed-app-file-io.mjs'),
    '--executable', $executable, '--output-root', $output, '--expected-profile', $profile,
    '--phase', $Phase, '--project', $project, '--expected-version', $ExpectedVersion, '--expected-commit', $SourceCommit
  )) { $startInfo.ArgumentList.Add($argument) }
  $process = [Diagnostics.Process]::Start($startInfo)
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $finished = $process.WaitForExit(240000)
  if (-not $finished) {
    $process.Kill($true)
    if (-not $process.WaitForExit(10000)) { throw "Owned file-I/O process tree did not terminate: $Label" }
  }
  $stdout.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $output 'harness-stdout.txt') -Encoding utf8
  $stderr.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $output 'harness-stderr.txt') -Encoding utf8
  if (-not $finished) { throw "Real installed-app file I/O exceeded four minutes: $Label" }
  if ($process.ExitCode -ne 0) { throw "Real installed-app file I/O failed: $Label (exit $($process.ExitCode))" }
  $result = Get-Content -LiteralPath (Join-Path $output 'result.json') -Raw | ConvertFrom-Json
  if ($result.status -ne 'passed') { throw "File I/O harness did not pass: $Label" }
  $steps.Add([pscustomobject]@{ name = $Label; evidence = $output; project = (Get-FileEvidence $project) })
  Write-Receipt
}

function Assert-DataRetained([string]$ExpectedProjectHash, [string]$ExpectedSentinelHash) {
  if ((Get-FileEvidence $project).sha256 -ne $ExpectedProjectHash -or
      (Get-FileEvidence $sentinel).sha256 -ne $ExpectedSentinelHash) {
    throw 'Saved project or profile sentinel changed during install/uninstall.'
  }
}

function Invoke-AssociatedProject {
  # Full qualification only: the saved project and normal profile belong to this
  # disposable hosted VM. Exercise Windows' open verb, not a direct exe launch.
  $ownedProject = Assert-ChildPath $project $ownedRoot
  if (-not (Test-Path -LiteralPath $ownedProject -PathType Leaf)) { throw 'Saved association fixture is missing.' }
  $projectBefore = Get-FileEvidence $ownedProject
  $startInfo = [Diagnostics.ProcessStartInfo]::new($ownedProject)
  $startInfo.UseShellExecute = $true
  $startInfo.Verb = 'open'
  $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $associated = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $associated) { throw 'The project open verb returned no owned process.' }
  $owned = $false
  try {
    if ($associated.MainModule.FileName -ne $executable) { throw 'The project association launched a different executable.' }
    $owned = $true
    $expectedTitle = 'KerfDesk — ' + [IO.Path]::GetFileName($ownedProject)
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
      $associated.Refresh()
      if ($associated.HasExited) { throw 'The associated app exited before opening the saved project.' }
      if ($associated.MainWindowTitle -eq $expectedTitle) { break }
      Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($associated.MainWindowTitle -ne $expectedTitle) { throw 'The associated app did not open the saved project.' }
    if (-not $associated.CloseMainWindow() -or -not $associated.WaitForExit(30000)) {
      throw 'The associated app did not close normally.'
    }
    if ($associated.ExitCode -ne 0) { throw "The associated app exited with $($associated.ExitCode)." }
    if ((Get-FileEvidence $ownedProject).sha256 -ne $projectBefore.sha256) { throw 'Opening by association changed the saved project.' }
    $steps.Add([pscustomobject]@{
      name = 'shell-open-saved-project'; executable = $executable
      project = $projectBefore; windowTitle = $expectedTitle; exitCode = $associated.ExitCode
    })
    Write-Receipt
  } finally {
    if ($owned -and -not $associated.HasExited) {
      $associated.Kill($true)
      if (-not $associated.WaitForExit(10000)) { throw 'Owned association process did not terminate.' }
    }
    $associated.Dispose()
  }
}

function Uninstall-Candidate([string]$Label) {
  $priorRecords = @(Get-InstallRecords)
  # Use only the known uninstaller in the verified owned directory, never registry command text.
  $ownedUninstaller = Assert-ChildPath $uninstaller $ownedRoot
  # NSIS normally spawns a detached copy, hiding its actual exit code. Copy it
  # ourselves outside installRoot and use documented _?= to wait for the worker.
  $copiedUninstaller = Assert-ChildPath (Join-Path $ownedRoot "$Label.exe") $ownedRoot
  Copy-Item -LiteralPath $ownedUninstaller -Destination $copiedUninstaller
  if ((Get-FileEvidence $ownedUninstaller).sha256 -ne (Get-FileEvidence $copiedUninstaller).sha256) {
    throw 'Copied uninstaller hash differs from the installed uninstaller.'
  }
  $exitCode = Invoke-BoundedProcess $copiedUninstaller "/S /currentuser _?=$installRoot"
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $records = @(Get-InstallRecords)
    $shortcuts = @(Get-Shortcuts)
    $remaining = @(if (Test-Path -LiteralPath $installRoot) { Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction Stop })
    $remainingKeys = @($priorRecords | Where-Object { Test-Path -LiteralPath $_.identityKey })
    $projectClass = Test-Path -LiteralPath $projectClassKey
    if ($records.Count -eq 0 -and $shortcuts.Count -eq 0 -and $remaining.Count -eq 0 -and $remainingKeys.Count -eq 0 -and -not $projectClass) { break }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($records.Count -ne 0 -or $shortcuts.Count -ne 0 -or $remaining.Count -ne 0 -or $remainingKeys.Count -ne 0 -or $projectClass) {
    throw 'Uninstall left application files, shortcuts, registration or the .lf2 project type behind.'
  }
  $steps.Add([pscustomobject]@{ name = $Label; exitCode = $exitCode; registry = $records; shortcuts = $shortcuts; remainingFiles = $remaining.Count })
  Write-Receipt
}

function Invoke-InstalledSmoke([string]$Label) {
  # The installed app launches, imports an SVG and saves a project on a throwaway
  # profile; the smoke's own deadline bounds it.
  $output = Join-Path $EvidenceRoot $Label
  & node (Join-Path $PSScriptRoot 'verify-windows-packaged-native-smoke.mjs') $executable "--output=$output"
  if ($LASTEXITCODE -ne 0) { throw "Installed app launch/import/save failed: $Label" }
  $steps.Add([pscustomobject]@{ name = $Label; evidence = $output })
  Write-Receipt
}

function Invoke-HistoricalProfile([string]$Label, [string]$Phase, [string]$ExpectedVersion, [string]$ExpectedSourceCommit) {
  $output = Join-Path $EvidenceRoot $Label
  $info = [Diagnostics.ProcessStartInfo]::new((Get-Command powershell.exe).Source)
  $info.UseShellExecute = $false; $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
  foreach ($argument in @('-NoProfile', '-NonInteractive', '-File',
    (Join-Path $PSScriptRoot 'installed-upgrade-profile.ps1'), '-Phase', $Phase,
    '-Executable', $executable, '-EvidenceRoot', $output, '-ExpectedProfile', $profile,
    '-Project', $project, '-ExpectedVersion', $ExpectedVersion, '-ExpectedCommit', $ExpectedSourceCommit)) {
    $info.ArgumentList.Add($argument)
  }
  $process = [Diagnostics.Process]::Start($info)
  $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
  $finished = $process.WaitForExit(300000)
  if (-not $finished) { $process.Kill($true); $process.WaitForExit(10000) | Out-Null }
  $stdout.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $EvidenceRoot "$Label-stdout.txt") -Encoding utf8
  $stderr.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $EvidenceRoot "$Label-stderr.txt") -Encoding utf8
  if (-not $finished -or $process.ExitCode -ne 0) { throw "Native historical profile qualification failed: $Label" }
  $result = Get-Content -LiteralPath (Join-Path $output 'result.json') -Raw | ConvertFrom-Json
  if ($result.status -ne 'passed') { throw "Native historical profile qualification did not pass: $Label" }
  $steps.Add([pscustomobject]@{ name = $Label; evidence = $output; project = (Get-FileEvidence $project) })
  Write-Receipt
}

if (Test-Path -LiteralPath $EvidenceRoot) { throw 'Evidence directory must be new.' }
New-Item -ItemType Directory -Path $EvidenceRoot | Out-Null
try {
  if ((Test-Path -LiteralPath $ownedRoot) -or (Test-Path -LiteralPath $profile) -or
      @(Get-InstallRecords).Count -ne 0 -or @(Get-Shortcuts).Count -ne 0 -or
      @(Get-Process -Name KerfDesk, LaserForge -ErrorAction SilentlyContinue).Count -ne 0) {
    throw 'Runner already contains KerfDesk installation, profile, shortcuts or processes; refusing.'
  }
  $candidates = foreach ($candidate in @($Installer, $UpgradeInstaller | Where-Object { $_ })) {
    $signature = (Get-AuthenticodeSignature -LiteralPath $candidate).Status.ToString()
    if ($signature -ne 'NotSigned') { throw "Expected unsigned test candidate, found $signature" }
    & (Join-Path $PSScriptRoot 'verify-windows-package-identity.ps1') -Executable $candidate -Kind Installer | Out-Null
    [pscustomobject]@{ file = (Get-FileEvidence $candidate); signature = $signature }
  }
  $receipt.candidates = @($candidates)
  New-Item -ItemType Directory -Path (Split-Path -Parent $project) -Force | Out-Null
  Write-Receipt
  if ($Scenario -eq 'Launch') {
    Install-Candidate 'fresh-install' $Installer $Version
    Invoke-InstalledSmoke 'installed-launch'
    Uninstall-Candidate 'final-uninstall'
    $receipt.status = 'passed'
    return
  }
  if ($Scenario -eq 'HistoricalUpgrade') {
    Install-Candidate 'historical-baseline-install' $Installer $Version $SourceCommit
    Invoke-HistoricalProfile 'native-historical-create' 'create' $Version $SourceCommit
    @{ sourceCommit = $SourceCommit; marker = [Guid]::NewGuid().ToString() } | ConvertTo-Json | Set-Content -LiteralPath $sentinel -Encoding utf8
    $projectHash = (Get-FileEvidence $project).sha256
    $sentinelHash = (Get-FileEvidence $sentinel).sha256
    Invoke-HistoricalProfile 'historical-restart-reopen' 'reopen' $Version $SourceCommit
    Install-Candidate 'historical-upgrade-install' $UpgradeInstaller $UpgradeVersion $UpgradeSourceCommit
    Assert-DataRetained $projectHash $sentinelHash
    Invoke-HistoricalProfile 'historical-upgrade-reopen' 'reopen' $UpgradeVersion $UpgradeSourceCommit
    Install-Candidate 'historical-same-version-reinstall' $UpgradeInstaller $UpgradeVersion $UpgradeSourceCommit
    Assert-DataRetained $projectHash $sentinelHash
    Invoke-HistoricalProfile 'historical-reinstall-reopen' 'reopen' $UpgradeVersion $UpgradeSourceCommit
    Uninstall-Candidate 'historical-uninstall-retaining-data'
    Assert-DataRetained $projectHash $sentinelHash
    Install-Candidate 'historical-install-after-uninstall' $UpgradeInstaller $UpgradeVersion $UpgradeSourceCommit
    Invoke-HistoricalProfile 'historical-restore-reopen' 'reopen' $UpgradeVersion $UpgradeSourceCommit
    Uninstall-Candidate 'historical-final-uninstall'
    Assert-DataRetained $projectHash $sentinelHash
    Copy-Item -LiteralPath $project -Destination (Join-Path $EvidenceRoot 'persisted-project.lf2')
    $receipt.status = 'passed'; $receipt.retainedProject = Get-FileEvidence $project
    $receipt.retainedProfileSentinel = Get-FileEvidence $sentinel
    return
  }
  Install-Candidate 'fresh-install' $Installer $Version
  Invoke-FileRoundtrip 'create-real-project' 'create' $Version
  Invoke-AssociatedProject
  if (-not (Test-Path -LiteralPath $profile -PathType Container)) { throw 'Normal app profile was not created.' }
  @{ sourceCommit = $SourceCommit; marker = [Guid]::NewGuid().ToString() } | ConvertTo-Json | Set-Content -LiteralPath $sentinel -Encoding utf8
  $projectHash = (Get-FileEvidence $project).sha256
  $sentinelHash = (Get-FileEvidence $sentinel).sha256
  Invoke-FileRoundtrip 'restart-reopen' 'reopen' $Version
  Install-Candidate 'upgrade-install' $UpgradeInstaller $UpgradeVersion
  Assert-DataRetained $projectHash $sentinelHash
  Invoke-FileRoundtrip 'upgrade-reopen' 'reopen' $UpgradeVersion
  Install-Candidate 'same-version-reinstall' $UpgradeInstaller $UpgradeVersion
  Assert-DataRetained $projectHash $sentinelHash
  Invoke-FileRoundtrip 'reinstall-reopen' 'reopen' $UpgradeVersion
  Uninstall-Candidate 'uninstall-retaining-data'
  Assert-DataRetained $projectHash $sentinelHash
  Install-Candidate 'install-after-uninstall' $UpgradeInstaller $UpgradeVersion
  Invoke-FileRoundtrip 'restore-reopen' 'reopen' $UpgradeVersion
  Uninstall-Candidate 'final-uninstall'
  Assert-DataRetained $projectHash $sentinelHash
  Copy-Item -LiteralPath $project -Destination (Join-Path $EvidenceRoot 'persisted-project.lf2')
  Copy-Item -LiteralPath $sentinel -Destination (Join-Path $EvidenceRoot 'retained-profile-sentinel.json')
  $receipt.status = 'passed'
  $receipt.retainedProject = Get-FileEvidence $project
  $receipt.retainedProfileSentinel = Get-FileEvidence $sentinel
} catch {
  $receipt.status = 'failed'
  $receipt.error = $_.ToString()
  throw
} finally {
  $receipt.finishedAt = [DateTime]::UtcNow.ToString('o')
  Write-Receipt
}
