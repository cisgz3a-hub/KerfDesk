param(
  [Parameter(Mandatory = $true)][ValidateSet('Preflight', 'Install', 'Reinstall', 'Uninstall')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE) {
  throw 'Licence installation requires a disposable hosted Windows runner.'
}
function Assert-NativeChild([string]$Path, [string]$Parent) {
  $full = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $full.Contains('"')) {
    throw 'Native licence qualification path escaped its owned parent.'
  }
  return $full
}
$Installer = Assert-NativeChild $Installer $env:GITHUB_WORKSPACE
$InstallRoot = Assert-NativeChild $InstallRoot $env:RUNNER_TEMP
if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$' -or (Split-Path -Leaf $InstallRoot) -ne 'KerfDesk Installed') {
  throw 'Native licence qualification installation identity is invalid.'
}
function Get-NativeInstallRecords {
  foreach ($root in @('HKCU:\Software', 'HKLM:\Software', 'HKLM:\Software\WOW6432Node')) {
    $uninstallRoot = Join-Path $root 'Microsoft\Windows\CurrentVersion\Uninstall'
    if (-not (Test-Path -LiteralPath $uninstallRoot)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $uninstallRoot) {
      $entry = Get-ItemProperty -LiteralPath $key.PSPath
      if ($entry.PSObject.Properties['DisplayName'] -and $entry.DisplayName -match '^(KerfDesk|LaserForge)(\s|$)') {
        $identity = Join-Path $root $key.PSChildName
        $location = if (Test-Path -LiteralPath $identity) { (Get-ItemProperty -LiteralPath $identity).InstallLocation } else { $null }
        [pscustomobject]@{ key = $key.Name; version = $entry.DisplayVersion; location = $location }
      }
    }
  }
}
function Invoke-NativeInstaller([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(180000)) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    throw 'Owned native installer timed out.'
  }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw 'Owned native installer failed.' }
}
$records = @(Get-NativeInstallRecords)
if ($Action -eq 'Preflight') {
  if ($records.Count -ne 0 -or (Test-Path -LiteralPath $InstallRoot)) {
    throw 'The disposable runner already has a KerfDesk installation.'
  }
  exit 0
}
if ($Action -eq 'Install') {
  if ($records.Count -ne 0 -or (Test-Path -LiteralPath $InstallRoot)) { throw 'Install requires a fresh owned location.' }
} elseif ($records.Count -ne 1 -or $records[0].key -notlike 'HKEY_CURRENT_USER\*' -or
          $records[0].version -ne $ExpectedVersion -or $records[0].location.TrimEnd('\') -ne $InstallRoot) {
  throw 'Installed registration does not belong to this qualification.'
}
if ($Action -in @('Install', 'Reinstall')) {
  # NSIS requires /D last and unquoted, including when the path contains spaces.
  Invoke-NativeInstaller $Installer "/S /currentuser /D=$InstallRoot"
  $after = @(Get-NativeInstallRecords)
  if ($after.Count -ne 1 -or $after[0].key -notlike 'HKEY_CURRENT_USER\*' -or
      $after[0].version -ne $ExpectedVersion -or $after[0].location.TrimEnd('\') -ne $InstallRoot -or
      -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'KerfDesk.exe'))) {
    throw 'Per-user installed version or registration did not match.'
  }
} else {
  $original = Assert-NativeChild (Join-Path $InstallRoot 'Uninstall KerfDesk.exe') $InstallRoot
  $copy = Assert-NativeChild (Join-Path (Split-Path -Parent $InstallRoot) 'owned-uninstaller.exe') $env:RUNNER_TEMP
  Copy-Item -LiteralPath $original -Destination $copy
  if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash) { throw 'Owned uninstaller copy differs.' }
  Invoke-NativeInstaller $copy "/S /currentuser _?=$InstallRoot"
  if (@(Get-NativeInstallRecords).Count -ne 0 -or
      (Test-Path -LiteralPath (Join-Path $InstallRoot 'KerfDesk.exe'))) { throw 'Owned uninstall did not finish.' }
}
