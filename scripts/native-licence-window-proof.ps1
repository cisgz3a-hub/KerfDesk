# Capture only the known edition button of this owned process. No UI tree or full screenshot is saved.
param(
  [Parameter(Mandatory = $true)][int]$AppProcessId,
  [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
  [Parameter(Mandatory = $true)][ValidateSet('Free', 'Pro')][string]$ExpectedEdition,
  [Parameter(Mandatory = $true)][string]$Output
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Window proof requires a disposable hosted Windows runner.' }
$expected = [IO.Path]::GetFullPath($ExpectedExecutable)
$temp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
$evidence = [IO.Path]::GetFullPath((Join-Path $env:GITHUB_WORKSPACE 'artifacts\installed-qualification')).TrimEnd('\') + '\'
$outputPath = [IO.Path]::GetFullPath($Output)
if (-not $expected.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or
    -not $outputPath.StartsWith($evidence, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($outputPath) -ne '.png' -or (Test-Path -LiteralPath $outputPath)) {
  throw 'Window proof paths are outside owned locations or not fresh.'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeLicenceWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
}
'@
$app = Get-Process -Id $AppProcessId
$started = $app.StartTime.ToUniversalTime()
$label = "Edition: $ExpectedEdition. Open licence settings"
$condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $label)
$licenceCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'KerfDesk licence')
$deadline = [DateTime]::UtcNow.AddSeconds(10)
function Assert-OwnedProofProcess {
  $app.Refresh()
  if ($app.HasExited -or $app.StartTime.ToUniversalTime() -ne $started -or
      -not [string]::Equals($app.MainModule.FileName, $expected, [StringComparison]::OrdinalIgnoreCase) -or
      $app.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Owned native proof window is unavailable.' }
}
function Assert-ProofPoint([int]$X, [int]$Y, [IntPtr]$Window) {
  $point = [NativeLicenceWindow+Point]::new()
  $point.X = $X; $point.Y = $Y
  if ([NativeLicenceWindow]::GetAncestor([NativeLicenceWindow]::WindowFromPoint($point), 2) -ne $Window) {
    throw 'The edition button is covered by another native window.'
  }
}
do {
  $bitmap = $null; $graphics = $null
  try {
    Assert-OwnedProofProcess
    $window = $app.MainWindowHandle
    $root = [Windows.Automation.AutomationElement]::FromHandle($window)
    if ($null -ne $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $licenceCondition)) {
      throw 'The private licence panel is still open.'
    }
    $button = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -eq $button -or $button.Current.IsOffscreen -or
        $button.Current.ControlType -ne [Windows.Automation.ControlType]::Button) { throw 'Edition button is not observable.' }
    $rect = $button.Current.BoundingRectangle
    $x = [int][Math]::Floor($rect.X); $y = [int][Math]::Floor($rect.Y)
    $width = [int][Math]::Ceiling($rect.Width); $height = [int][Math]::Ceiling($rect.Height)
    if ($width -lt 5 -or $width -gt 500 -or $height -lt 5 -or $height -gt 100) { throw 'Edition crop is out of bounds.' }
    Assert-ProofPoint $x $y $window
    Assert-ProofPoint ($x + $width - 1) ($y + $height - 1) $window
    $bitmap = [Drawing.Bitmap]::new($width, $height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($x, $y, 0, 0, $bitmap.Size)
    Assert-OwnedProofProcess
    Assert-ProofPoint $x $y $window
    Assert-ProofPoint ($x + $width - 1) ($y + $height - 1) $window
    if ($button.Current.Name -ne $label -or
        $null -ne $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $licenceCondition)) { throw 'Edition crop changed during capture.' }
    $bitmap.Save($outputPath, [Drawing.Imaging.ImageFormat]::Png)
    exit 0
  } catch {
    $app.Refresh()
    if ($app.HasExited) { exit 2 }
  } finally {
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
  }
  Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $deadline)
exit 2
