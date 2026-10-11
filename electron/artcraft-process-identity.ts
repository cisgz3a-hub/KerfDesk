import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
export type EditorProcessIdentity = { pid: number; startTime: string; executable: string };
const IDENTITY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$p = Get-Process -Id ([int]$env:KERFDESK_EDITOR_IDENTITY_PID) -ErrorAction SilentlyContinue
if ($null -eq $p) { Write-Output 'null'; exit 0 }
$executable = $p.Path
if ([string]::IsNullOrEmpty($executable)) { throw 'Process executable is unavailable' }
@{ pid = $p.Id; startTime = $p.StartTime.ToUniversalTime().Ticks.ToString(); executable = $executable } | ConvertTo-Json -Compress
`;

/** Read process identity without signalling it; absence and inaccessible state stay distinct. */
export async function readEditorProcessIdentity(
  pid: number,
): Promise<EditorProcessIdentity | null> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid editor process id');
  const executable = path.join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const { stdout } = await runFile(
    executable,
    ['-NoProfile', '-NonInteractive', '-Command', IDENTITY_SCRIPT],
    {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 8192,
      encoding: 'utf8',
      env: { ...process.env, KERFDESK_EDITOR_IDENTITY_PID: String(pid) },
    },
  );
  const value: unknown = JSON.parse(stdout.trim());
  if (value === null) return null;
  if (!validEditorProcessIdentity(value) || value.pid !== pid)
    throw new Error('Invalid editor process identity');
  return value;
}

export function validEditorProcessIdentity(value: unknown): value is EditorProcessIdentity {
  if (!value || typeof value !== 'object') return false;
  if (!('pid' in value) || !Number.isInteger(value.pid) || Number(value.pid) <= 0) return false;
  return (
    'startTime' in value &&
    typeof value.startTime === 'string' &&
    /^\d+$/.test(value.startTime) &&
    'executable' in value &&
    typeof value.executable === 'string' &&
    path.isAbsolute(value.executable)
  );
}
export function sameExecutable(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}
