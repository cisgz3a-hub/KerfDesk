# Windows' open verb must show the app: a hidden launch has no observable
# Process.MainWindowHandle/Title, even when the saved project loaded correctly.
function New-AssociationProjectStartInfo([string]$Project) {
  $info = [Diagnostics.ProcessStartInfo]::new($Project)
  $info.UseShellExecute = $true
  $info.Verb = 'open'
  $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Normal
  return $info
}

# Qualification still decides success from its exact title, executable, normal
# exit and unchanged saved project checks. These helpers only retain diagnostics.
function Add-AssociationProcessObservation($Evidence, $Process) {
  $Process.Refresh()
  $observation = [ordered]@{
    observedAt = [DateTime]::UtcNow.ToString('o'); processId = $Process.Id
    exited = $Process.HasExited; windowTitle = $null; windowHandle = $null
  }
  if (-not $observation.exited) {
    $observation.windowTitle = $Process.MainWindowTitle
    $observation.windowHandle = $Process.MainWindowHandle.ToInt64()
  }
  $previous = $Evidence.lastObservation
  $Evidence.lastObservation = $observation
  if ($null -eq $previous -or $previous.exited -ne $observation.exited -or
      $previous.windowTitle -cne $observation.windowTitle -or
      $previous.windowHandle -ne $observation.windowHandle) {
    if ($Evidence.observations.Count -lt 16) { $Evidence.observations.Add($observation) }
    else { $Evidence.observationsTruncated = $true }
  }
}

function Save-AssociationWindowEvidence([int]$AppProcessId, [string]$Executable, [string]$Output) {
  [IO.Directory]::CreateDirectory($Output) | Out-Null
  $info = New-QualificationWindowsPowerShell
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($argument in @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'installed-file-dialog.ps1'), '-Action', 'Inspect',
    '-AppProcessId', [string]$AppProcessId, '-ExpectedExecutable', $Executable,
    '-EvidenceRoot', $Output
  )) { $info.ArgumentList.Add($argument) }
  $helper = [Diagnostics.Process]::Start($info)
  try {
    $stdout = $helper.StandardOutput.ReadToEndAsync()
    $stderr = $helper.StandardError.ReadToEndAsync()
    $finished = $helper.WaitForExit(15000)
    if (-not $finished) {
      $helper.Kill($true)
      if (-not $helper.WaitForExit(5000)) { throw 'Association evidence helper did not terminate.' }
    }
    $stdout.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $Output 'stdout.txt') -Encoding utf8
    $stderr.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $Output 'stderr.txt') -Encoding utf8
    return @{ path = $Output; timedOut = -not $finished; exitCode = $helper.ExitCode }
  } finally { $helper.Dispose() }
}
