import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test(
  'native Hide succeeds before attachment and after a window disappears',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const source = fileURLToPath(new URL('./artcraft-window-host.ps1', import.meta.url));
    const command = `
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($env:KERFDESK_TEST_HOST_SOURCE)
$start = $source.IndexOf('using System;')
$end = $source.IndexOf('"@', $start)
Add-Type -TypeDefinition $source.Substring($start, $end - $start)
[KerfDeskWindowHost]::Hide('never-attached')
$flags = [Reflection.BindingFlags]::NonPublic -bor [Reflection.BindingFlags]::Static
$entries = [KerfDeskWindowHost].GetField('entries', $flags).GetValue($null)
$entry = New-Object 'KerfDeskWindowHost+Entry'
$entry.Window = [IntPtr]::Zero
$entry.Pid = $PID
$entries.Add('closed-window', $entry)
[KerfDeskWindowHost]::Hide('closed-window')
[KerfDeskWindowHost]::Hide('closed-window')
if ($entries.ContainsKey('closed-window')) { throw 'Stale window remains registered' }
`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      env: { ...process.env, KERFDESK_TEST_HOST_SOURCE: source },
      timeout: 30_000,
      stdio: 'pipe',
    });
  },
);
