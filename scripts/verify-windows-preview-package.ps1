param(
  [Parameter(Mandatory = $true)][string]$Version
)

# The Windows Preview package contract (ADR-248/249). The Preview release lane
# runs it on every tag and the desktop package check on every pull request
# (ADR-522), so a change that breaks the next Preview fails before anyone tags.
# Run it after the build's updater metadata has been removed.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$releaseDir = "release/$Version"
$installer = "$releaseDir/KerfDesk-$Version-windows-x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Missing canonical Windows Preview installer: $installer"
}

$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'NotSigned') {
  throw "Preview installer must be unsigned; found $($signature.Status)."
}
& (Join-Path $PSScriptRoot 'verify-windows-package-identity.ps1') `
  -Executable $installer `
  -Kind Installer

$unexpectedMetadata = Get-ChildItem -LiteralPath $releaseDir -Recurse -File |
  Where-Object { $_.Name -match '^latest.*\.(yml|yaml|json)$' -or $_.Extension -eq '.blockmap' }
if ($unexpectedMetadata) {
  throw "Preview emitted updater metadata: $($unexpectedMetadata.FullName -join ', ')"
}

$unpacked = Join-Path $releaseDir 'win-unpacked'
$executable = Join-Path $unpacked 'KerfDesk.exe'
& (Join-Path $PSScriptRoot 'verify-windows-package-identity.ps1') -Executable $executable
$bytes = [IO.File]::ReadAllBytes($executable)
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
$machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
if ($machine -ne 0x8664) {
  throw "Preview executable must be x64 PE32+; machine field was 0x$($machine.ToString('x4'))."
}

$required = @(
  (Join-Path $unpacked 'LICENSE.electron.txt'),
  (Join-Path $unpacked 'LICENSES.chromium.html'),
  (Join-Path $unpacked 'resources/legal/LICENSE'),
  (Join-Path $unpacked 'resources/legal/THIRD_PARTY_NOTICES.md'),
  (Join-Path $unpacked 'resources/legal/third-party-notices.txt')
)
foreach ($path in $required) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Packaged legal material is missing: $path"
  }
}

$archive = Join-Path $unpacked 'resources/app.asar'
node (Join-Path $PSScriptRoot 'verify-packaged-preview-metadata.mjs') $archive $Version
if ($LASTEXITCODE -ne 0) { throw 'Packaged Preview metadata, version or updater trust is wrong.' }

Write-Output "Windows x64 Preview package contract verified for $Version"
