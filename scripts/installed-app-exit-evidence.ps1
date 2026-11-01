# Keeps what can classify an installed KerfDesk that closed with a non-zero exit
# code (rolling audit v8 N7-P3-2). Both the pwsh driver and its Windows
# PowerShell 5.1 children load this file, so it stays ASCII and 5.1-compatible.

# Windows reports a crash as an NTSTATUS code, such as 0xC0000005 for an access
# violation or 0x80000003 for a breakpoint, which reads as a negative decimal.
function Format-InstalledAppExitCode([int]$ExitCode) {
  return '0x{0:X8}' -f $ExitCode
}

# Best effort, and it never throws: the caller still reports the original
# failure. Copies the newest part of the app's support log (ADR-546, which
# already removes licence keys and the home folder) and the Application Error
# and Windows Error Reporting events that name the executable since $Since.
function Save-InstalledAppExitEvidence([string]$ProfilePath, [string]$Output, [DateTime]$Since, [string]$Executable, [string]$Redact = '') {
  $evidence = [ordered]@{}
  try {
    [IO.Directory]::CreateDirectory($Output) | Out-Null
  } catch {
    $evidence.error = $_.ToString()
    return $evidence
  }
  $log = Join-Path $ProfilePath 'logs\kerfdesk.log'
  try {
    if (-not (Test-Path -LiteralPath $log -PathType Leaf)) {
      $evidence.supportLog = 'not present'
    } else {
      $stream = [IO.FileStream]::new($log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try {
        $total = $stream.Length
        $count = [int][Math]::Min($total, 65536)
        $stream.Seek(-$count, [IO.SeekOrigin]::End) | Out-Null
        $bytes = New-Object byte[] $count
        $read = 0
        while ($read -lt $count) {
          $chunk = $stream.Read($bytes, $read, $count - $read)
          if ($chunk -le 0) { break }
          $read += $chunk
        }
      } finally { $stream.Dispose() }
      $text = [Text.Encoding]::UTF8.GetString($bytes, 0, $read)
      # Start on a whole line, as the app's own support report does.
      $lineStart = $text.IndexOf([char]10)
      if ($read -lt $total -and $lineStart -ge 0) { $text = $text.Substring($lineStart + 1) }
      if ($Redact) { $text = $text.Replace($Redact, '[removed]') }
      [IO.File]::WriteAllText((Join-Path $Output 'kerfdesk-log-tail.txt'), $text, [Text.UTF8Encoding]::new($false))
      # "KerfDesk quit." is written at will-quit. Missing after the last start
      # line, the process ended before Electron's normal quit finished.
      $starts = [regex]::Matches($text, '\[app\] KerfDesk \S+ started \(')
      $quitAfterLastStart = $null
      if ($starts.Count -gt 0) {
        $quitAfterLastStart = $text.IndexOf('[app] KerfDesk quit.', $starts[$starts.Count - 1].Index, [StringComparison]::Ordinal) -ge 0
      }
      $evidence.supportLog = [ordered]@{
        file = 'kerfdesk-log-tail.txt'; totalBytes = $total; copiedBytes = $read
        quitAfterLastStart = $quitAfterLastStart
      }
    }
  } catch { $evidence.supportLogError = $_.ToString() }
  try {
    $name = [regex]::Escape([IO.Path]::GetFileName($Executable))
    $filter = @{ LogName = 'Application'; ProviderName = @('Application Error', 'Windows Error Reporting'); StartTime = $Since }
    # Windows Error Reporting writes its events a moment after the process ends.
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
      $found = @()
      try {
        $found = @(Get-WinEvent -FilterHashtable $filter -ErrorAction Stop | Where-Object { $_.Message -match $name })
      } catch {
        if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw }
      }
      if ($found.Count -gt 0) { break }
      Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    $events = @($found | Select-Object -First 20 | ForEach-Object {
      [ordered]@{
        timeCreated = $_.TimeCreated.ToUniversalTime().ToString('o'); provider = $_.ProviderName
        id = $_.Id; message = $_.Message
      }
    })
    ConvertTo-Json -InputObject $events -Depth 4 | Set-Content -LiteralPath (Join-Path $Output 'windows-error-events.json') -Encoding utf8
    $evidence.windowsErrorEvents = [ordered]@{ file = 'windows-error-events.json'; count = $events.Count }
  } catch { $evidence.windowsErrorEventsError = $_.ToString() }
  return $evidence
}
