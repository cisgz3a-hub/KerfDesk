import { realpathSync } from 'node:fs';
import { win32 } from 'node:path';

type PrivateReport = NodeJS.ProcessReport & { excludeEnv: boolean; excludeNetwork: boolean };

/**
 * Find Windows from the system libraries loaded by the OS, not SystemRoot,
 * WINDIR, ComSpec or PATH supplied by the process that launched KerfDesk.
 * Those variables can otherwise substitute a fake reg.exe and reset a trial's
 * installation identity without changing the registry or the packaged app.
 */
export function windowsRegistryCommand(): string {
  return realpathSync.native(registryCommandFromModules(loadedModules()));
}

/** Windows PowerShell from the same verified system directory as reg.exe (ADR-592). */
export function windowsPowerShellCommand(): string {
  const registry = registryCommandFromModules(loadedModules());
  return realpathSync.native(
    win32.join(win32.dirname(registry), 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  );
}

function loadedModules(): unknown {
  const report = process.report as PrivateReport;
  const previous = { env: report.excludeEnv, network: report.excludeNetwork };
  let loaded: unknown;
  try {
    // Only inspect the in-memory module list. Never write or log a report.
    report.excludeEnv = true;
    report.excludeNetwork = true;
    loaded = report.getReport();
  } finally {
    report.excludeEnv = previous.env;
    report.excludeNetwork = previous.network;
  }
  return loaded;
}

export function registryCommandFromModules(report: unknown): string {
  if (typeof report !== 'object' || report === null || !('sharedObjects' in report))
    throw new Error('The Windows system directory is unavailable.');
  const modules: unknown = report.sharedObjects;
  if (!Array.isArray(modules)) throw new Error('The Windows system directory is unavailable.');
  const systemDlls = modules.filter(
    (value): value is string =>
      typeof value === 'string' && /\\(?:ntdll|kernel32)\.dll$/i.test(value),
  );
  const first = systemDlls[0];
  if (
    first === undefined ||
    systemDlls.length !== 2 ||
    !systemDlls.every((value) => /^[a-z]:\\.*\\system32\\(?:ntdll|kernel32)\.dll$/i.test(value)) ||
    new Set(systemDlls.map((value) => win32.basename(value).toLowerCase())).size !== 2 ||
    new Set(systemDlls.map((value) => win32.dirname(value).toLowerCase())).size !== 1
  )
    throw new Error('The Windows system directory could not be verified.');
  return win32.join(win32.dirname(first), 'reg.exe');
}
