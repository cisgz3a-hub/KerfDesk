param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [ValidateSet('App', 'Installer')]
  [string]$Kind = 'App',
  [string]$SourceCommit
)

$ErrorActionPreference = 'Stop'
$expectedCompanyName = 'Johann Stolk'
$expectedProductName = 'KerfDesk'
$appFileDescription = 'KerfDesk'
$expectedFileDescription = if ($Kind -eq 'Installer') {
  # NSIS takes FileDescription from package.json. Historical upgrade baselines
  # must use their authenticated source, not today's package description.
  $repository = Split-Path -Parent $PSScriptRoot
  $metadata = if ($SourceCommit) {
    if ($SourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'Expected a full package source commit.' }
    $text = & git -C $repository show "${SourceCommit}:package.json"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read package metadata at the expected source.' }
    ($text -join "`n") | ConvertFrom-Json
  } else {
    Get-Content -LiteralPath (Join-Path $repository 'package.json') -Raw | ConvertFrom-Json
  }
  if ($metadata.description -isnot [string] -or [string]::IsNullOrWhiteSpace($metadata.description)) {
    throw 'Package metadata must declare the installer description.'
  }
  $metadata.description
} else {
  $appFileDescription
}
$copyrightSymbol = [char]0x00A9
$expectedLegalCopyright = "Copyright $copyrightSymbol 2026 Johann Stolk"

if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
  throw "Missing packaged Windows executable: $Executable"
}

$versionInfo = (Get-Item -LiteralPath $Executable).VersionInfo

function Assert-PackageField {
  param(
    [string]$Label,
    [string]$Actual,
    [string]$Expected
  )
  if ($Actual -ne $Expected) {
    throw "Windows $Label mismatch: expected '$Expected', found '$Actual'."
  }
}

Assert-PackageField -Label 'CompanyName' -Actual $versionInfo.CompanyName -Expected $expectedCompanyName
Assert-PackageField -Label 'ProductName' -Actual $versionInfo.ProductName -Expected $expectedProductName
Assert-PackageField -Label 'FileDescription' -Actual $versionInfo.FileDescription -Expected $expectedFileDescription
Assert-PackageField -Label 'LegalCopyright' -Actual $versionInfo.LegalCopyright -Expected $expectedLegalCopyright

Write-Output "Windows package identity verified for $Executable"
