param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [ValidateSet('App', 'Installer')]
  [string]$Kind = 'App'
)

$ErrorActionPreference = 'Stop'
$expectedCompanyName = 'Johann Stolk'
$expectedProductName = 'KerfDesk'
$appFileDescription = 'KerfDesk'
$installerFileDescription = 'Focused GRBL CAM application for laser cutters, engravers, and CNC routers. Web + Windows desktop from one codebase. MIT licensed.'
$expectedFileDescription = if ($Kind -eq 'Installer') {
  $installerFileDescription
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
