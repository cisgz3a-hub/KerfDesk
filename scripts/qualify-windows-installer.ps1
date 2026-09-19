param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$UpgradeInstaller,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$UpgradeVersion,
  [Parameter(Mandatory = $true)][string]$SourceCommit,
  [Parameter(Mandatory = $true)][string]$EvidenceRoot
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

function Assert-ChildPath([string]$Path, [string]$Parent) {
  $full = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside its owned parent: $full"
  }
  return $full
}

$Installer = Assert-ChildPath $Installer $env:GITHUB_WORKSPACE
$UpgradeInstaller = Assert-ChildPath $UpgradeInstaller $env:GITHUB_WORKSPACE
$EvidenceRoot = Assert-ChildPath $EvidenceRoot $env:GITHUB_WORKSPACE
$ownedRoot = Assert-ChildPath (Join-Path $env:RUNNER_TEMP "kerfdesk-installer-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT") $env:RUNNER_TEMP
$installRoot = Assert-ChildPath (Join-Path $ownedRoot 'KerfDesk Installed') $ownedRoot
$executable = Join-Path $installRoot 'KerfDesk.exe'
$uninstaller = Join-Path $installRoot 'Uninstall KerfDesk.exe'
$profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'laserforge'
$project = Join-Path $ownedRoot 'projects\real saved project.lf2'
$sentinel = Join-Path $profile 'installer-qualification-sentinel.json'
$shortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'KerfDesk.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'KerfDesk.lnk')
)
$steps = [Collections.Generic.List[object]]::new()
$receipt = [ordered]@{
  schemaVersion = 1; status = 'running'; startedAt = [DateTime]::UtcNow.ToString('o')
  sourceCommit = $SourceCommit; runId = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT
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
  versions = @($Version, $UpgradeVersion); steps = $steps
  limitations = @(
    'Unsigned manual installer upgrade; production signed automatic updates remain unqualified.',
    'Both candidates use this same source commit; historical release/profile migrations remain separate checks.',
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

function Assert-Installed([string]$ExpectedVersion, [string]$Candidate) {
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
  & node (Join-Path $PSScriptRoot 'verify-packaged-preview-metadata.mjs') $installedAsar.path $ExpectedVersion | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Installed Preview metadata/version/updater trust verification failed.' }
  $shortcuts = @(Get-Shortcuts)
  if ($shortcuts.Count -ne 2 -or @($shortcuts | Where-Object target -NE $executable).Count -ne 0) {
    throw 'Expected desktop and Start Menu shortcuts to the installed executable.'
  }
  return [pscustomobject]@{
    registry = $records; asar = $installedAsar; candidateAsar = $candidateAsar
    executable = $installedExecutable; candidateExecutable = $candidateExecutable
    shortcuts = $shortcuts; previewMetadataVerified = $true; trustedUpdater = $false
  }
}

function Install-Candidate([string]$Label, [string]$Candidate, [string]$ExpectedVersion) {
  $started = [DateTime]::UtcNow
  # NSIS /D must be the final argument and is intentionally unquoted, including spaces.
  $exitCode = Invoke-BoundedProcess $Candidate "/S /currentuser /D=$installRoot"
  $state = Assert-Installed $ExpectedVersion $Candidate
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
    if ($records.Count -eq 0 -and $shortcuts.Count -eq 0 -and $remaining.Count -eq 0 -and $remainingKeys.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($records.Count -ne 0 -or $shortcuts.Count -ne 0 -or $remaining.Count -ne 0 -or $remainingKeys.Count -ne 0) {
    throw 'Uninstall left application files, shortcuts or registration behind.'
  }
  $steps.Add([pscustomobject]@{ name = $Label; exitCode = $exitCode; registry = $records; shortcuts = $shortcuts; remainingFiles = $remaining.Count })
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
  $candidates = foreach ($candidate in @($Installer, $UpgradeInstaller)) {
    $signature = (Get-AuthenticodeSignature -LiteralPath $candidate).Status.ToString()
    if ($signature -ne 'NotSigned') { throw "Expected unsigned test candidate, found $signature" }
    & (Join-Path $PSScriptRoot 'verify-windows-package-identity.ps1') -Executable $candidate -Kind Installer | Out-Null
    [pscustomobject]@{ file = (Get-FileEvidence $candidate); signature = $signature }
  }
  $receipt.candidates = @($candidates)
  New-Item -ItemType Directory -Path (Split-Path -Parent $project) -Force | Out-Null
  Write-Receipt
  Install-Candidate 'fresh-install' $Installer $Version
  Invoke-FileRoundtrip 'create-real-project' 'create' $Version
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
