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

test(
  'native recovery verifies host and every descendant owner after helper loss',
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
$code = $source.Substring($start, $end - $start)
# Replace only the three Win32 observation calls. Exercise the production
# recovery method against ownership/disappearance cases without touching apps.
$code = $code.Replace('[DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);', 'private static bool IsWindow(IntPtr window) { return TestOwners.ContainsKey(window.ToInt64()); }')
$code = $code.Replace('[DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);', 'private static uint GetWindowThreadProcessId(IntPtr window, out uint pid) { return TestOwners.TryGetValue(window.ToInt64(), out pid) ? 1U : 0U; }')
$code = $code.Replace('[DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);', 'private static bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data) { foreach(long id in TestChildren) { if(!callback(new IntPtr(id), data)) break; } return false; }')
$code = $code.Replace('public static void Init(', 'public static Dictionary<long,uint> TestOwners = new Dictionary<long,uint>(); public static List<long> TestChildren = new List<long>(); public static void Init(')
Add-Type -TypeDefinition $code
[KerfDeskWindowHost]::TestOwners.Add(1,42)
[KerfDeskWindowHost]::Init(42,'1')
[KerfDeskWindowHost]::VerifyDetached()
[KerfDeskWindowHost]::TestOwners.Add(2,42)
[KerfDeskWindowHost]::TestChildren.Add(2)
[KerfDeskWindowHost]::VerifyDetached()
[KerfDeskWindowHost]::TestOwners.Add(3,99)
[KerfDeskWindowHost]::TestChildren.Add(3)
$refused = $false
try { [KerfDeskWindowHost]::VerifyDetached() } catch { $refused = $true }
if (-not $refused) { throw 'Foreign descendant was accepted' }
[void][KerfDeskWindowHost]::TestOwners.Remove(3)
$refused = $false
try { [KerfDeskWindowHost]::VerifyDetached() } catch { $refused = $true }
if (-not $refused) { throw 'Unconfirmed descendant ownership was accepted' }
[void][KerfDeskWindowHost]::TestChildren.Remove(3)
[KerfDeskWindowHost]::VerifyDetached()
[KerfDeskWindowHost]::TestOwners[1] = 99
$refused = $false
try { [KerfDeskWindowHost]::VerifyDetached() } catch { $refused = $true }
if (-not $refused) { throw 'Reused parent identity was accepted' }
`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      env: { ...process.env, KERFDESK_TEST_HOST_SOURCE: source },
      timeout: 30_000,
      stdio: 'pipe',
    });
  },
);
