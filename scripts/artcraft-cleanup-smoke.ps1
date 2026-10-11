# Close only native windows created by the synthetic unified-studio smoke.
param([Parameter(Mandatory=$true)][string]$EvidenceFile)
$ErrorActionPreference = 'Stop'
$evidence = Get-Content -LiteralPath $EvidenceFile -Raw | ConvertFrom-Json
$runRoot = [IO.Path]::GetFullPath($evidence.run)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class StudioSmokeCleanup {
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w, out uint pid);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr w,uint m,IntPtr a,IntPtr b);
}
"@
foreach ($entry in $evidence.hosted) {
  $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$entry.pid)
  if ($null -eq $processInfo -or $processInfo.CommandLine.IndexOf($runRoot, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
  if ($processInfo.Name -notin @('photocraft.exe','vectorcraft.exe')) { continue }
  $handle = [IntPtr]::new([long]$entry.window)
  [uint32]$windowPid = 0
  [void][StudioSmokeCleanup]::GetWindowThreadProcessId($handle, [ref]$windowPid)
  if ($windowPid -eq [uint32]$entry.pid) {
    [void][StudioSmokeCleanup]::PostMessage($handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
  }
}
