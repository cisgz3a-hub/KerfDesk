import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

const execute = promisify(execFile);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const inside = (root, path) => {
  const part = relative(root, path);
  return part !== '' && !part.startsWith('..') && !isAbsolute(part);
};

export async function readWindowsProcess(pid) {
  if (process.platform !== 'win32') throw new Error('Packaged observation requires Windows');
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process PID');
  const command = `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { throw 'Process missing' }; @{pid=[int]$p.ProcessId; executable=$p.ExecutablePath; commandLine=$p.CommandLine; startedAt=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`;
  const { stdout } = await execute(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    },
  );
  return JSON.parse(stdout);
}

// Accept only unquoted tokens or whole quoted arguments; ambiguous Windows
// escaping fails closed. Paths with spaces must quote the entire --flag=value.
export function observationArguments(commandLine) {
  if (typeof commandLine !== 'string') throw new Error('Missing process command line');
  const tokens = commandLine.match(/"[^"]*"|[^\s"]+/g) ?? [];
  if (tokens.join(' ') !== commandLine.trim().replace(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ' '))
    throw new Error('Unsupported process command line quoting');
  const args = tokens.map((token) => (token.startsWith('"') ? token.slice(1, -1) : token));
  const value = (prefix) => {
    const matches = args.filter((arg) => arg.startsWith(prefix));
    if (matches.length !== 1 || !matches[0].slice(prefix.length))
      throw new Error(`Missing or duplicate ${prefix}`);
    return matches[0].slice(prefix.length);
  };
  if (!args.includes('--kerfdesk-native-smoke-interactive'))
    throw new Error('Not an isolated interactive observation launch');
  return {
    profile: value('--kerfdesk-native-smoke-user-data='),
    result: value('--kerfdesk-native-smoke-result='),
  };
}

export async function verifyObservationOwner(options, readProcess = readWindowsProcess) {
  const pid = Number(options['expected-pid']);
  const current = await readProcess(pid);
  if (current.pid !== pid || !current.startedAt || !Number.isFinite(Date.parse(current.startedAt)))
    throw new Error('Invalid process identity');
  const args = observationArguments(current.commandLine);
  for (const path of [
    options.executable,
    options['expected-profile'],
    options['isolation-root'],
    current.executable,
    args.profile,
    args.result,
  ]) {
    if (typeof path !== 'string' || !isAbsolute(path))
      throw new Error('Absolute executable, profile and isolation-root paths required');
  }
  const [executable, actualExecutable, profile, actualProfile, root, result] = await Promise.all(
    [
      options.executable,
      current.executable,
      options['expected-profile'],
      args.profile,
      options['isolation-root'],
      args.result,
    ].map((path) => realpath(path)),
  );
  if (!same(executable, actualExecutable)) throw new Error('Process executable mismatch');
  if (!same(profile, actualProfile)) throw new Error('Process profile mismatch');
  if (!inside(root, profile) || !inside(root, result))
    throw new Error('Observation paths must be inside isolation root');
  if (!(await stat(profile)).isDirectory())
    throw new Error('Profile must be an existing directory');
  // Canonical paths defeat junction aliases into the ordinary roaming profile.
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('Cannot determine ordinary Windows profile root');
  const ordinary = await realpath(appData);
  if (
    same(ordinary, root) ||
    inside(ordinary, root) ||
    same(ordinary, profile) ||
    inside(ordinary, profile) ||
    same(ordinary, result) ||
    inside(ordinary, result)
  )
    throw new Error('Ordinary app/user profile is forbidden');
  const receiptStat = await stat(result);
  if (receiptStat.mtimeMs < Date.parse(current.startedAt))
    throw new Error('Observation receipt predates process');
  const receipt = JSON.parse(await readFile(result, 'utf8'));
  if (
    receipt.mode !== 'interactive-observation' ||
    receipt.isPackaged !== true ||
    receipt.isolated !== true ||
    receipt.readyToShow !== true
  )
    throw new Error('Missing native isolated observation evidence');
  for (const path of [receipt.userData, receipt.sessionData]) {
    if (typeof path !== 'string' || !isAbsolute(path) || !same(await realpath(path), profile))
      throw new Error('Native runtime profile mismatch');
  }
  return {
    pid,
    executable,
    profile,
    isolationRoot: root,
    result,
    startedAt: current.startedAt,
    commandLine: current.commandLine,
  };
}

export function assertSameObservationOwner(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Observation process/profile ownership changed');
}
