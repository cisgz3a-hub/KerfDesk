import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { windowsPowerShellCommand, windowsRegistryCommand } from './windows-registry-command.js';

const exec = promisify(execFile);
type DeviceDependencies = {
  readonly platform: string;
  readonly read: (path: string) => Promise<string>;
  readonly execute: (file: string, args: ReadonlyArray<string>) => Promise<string>;
};

const dependencies: DeviceDependencies = {
  platform: process.platform,
  read: (path) => readFile(path, 'utf8'),
  execute: async (file, args) =>
    (
      await exec(systemCommand(file), [...args], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 64 * 1024,
      })
    ).stdout,
};

function systemCommand(file: string): string {
  if (file === 'reg.exe') return windowsRegistryCommand();
  if (file === 'powershell.exe') return windowsPowerShellCommand();
  return file;
}

// Firmware UUIDs that many boards share instead of a real serial. Binding a
// trial to one would refuse honest users with the same board (ADR-592).
const PLACEHOLDER_UUIDS = new Set([
  '03000200-0400-0500-0006-000700080009',
  '00020003-0004-0005-0006-000700080009',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A firmware UUID that identifies one machine, or null for a missing or shared value. */
export function usableHardwareUuid(value: string | undefined): string | null {
  const uuid = value?.trim().toLowerCase();
  if (uuid === undefined || !UUID.test(uuid) || PLACEHOLDER_UUIDS.has(uuid)) return null;
  const digits = uuid.replaceAll('-', '');
  // All one digit (all zeros, all F) or a run of one repeated byte pair.
  if (new Set(digits).size <= 2) return null;
  return uuid;
}

/**
 * A product-specific digest of this computer's firmware (SMBIOS) UUID, which a
 * user cannot change in the registry the way the Windows installation ID can.
 * Sent only when starting a trial. Null whenever it is unavailable or shared,
 * so it can never stop an honest trial on its own (ADR-592).
 */
export async function licensingHardwareId(
  deps: DeviceDependencies = dependencies,
): Promise<string | null> {
  if (deps.platform !== 'win32') return null;
  try {
    const output = await deps.execute('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID',
    ]);
    const uuid = usableHardwareUuid(output);
    return uuid === null
      ? null
      : createHash('sha256')
          .update(`kerfdesk-desktop:hardware:v1:${deps.platform}:${uuid}`)
          .digest('base64url');
  } catch {
    return null;
  }
}

/** The server sees only a product-specific digest, never the OS identifier. */
export async function licensingDeviceId(deps: DeviceDependencies = dependencies): Promise<string> {
  let installation: string | undefined;
  if (deps.platform === 'win32') {
    const output = await deps.execute('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid',
      '/reg:64',
    ]);
    installation = /MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/.exec(output)?.[1];
  } else if (deps.platform === 'darwin') {
    const output = await deps.execute('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    installation = /"IOPlatformUUID"\s*=\s*"([a-fA-F0-9-]+)"/.exec(output)?.[1];
  } else if (deps.platform === 'linux') {
    installation = (await deps.read('/etc/machine-id')).trim();
  }
  if (
    installation === undefined ||
    !/^[a-fA-F0-9-]{32,36}$/.test(installation) ||
    /^0+$/.test(installation.replaceAll('-', ''))
  ) {
    throw new Error('A stable device identity is unavailable. Contact KerfDesk support.');
  }
  return createHash('sha256')
    .update(`kerfdesk-desktop:device:v1:${deps.platform}:${installation.toLowerCase()}`)
    .digest('base64url');
}

/**
 * Reads the device identity once per process instead of starting reg.exe for
 * every licence read, action and update candidate. A failed read is not kept,
 * so the next request tries again (ADR-523 Amendment 2).
 */
export function rememberDeviceId(read: () => Promise<string>): () => Promise<string> {
  let known: Promise<string> | null = null;
  return () => {
    known ??= read().catch((error: unknown) => {
      known = null;
      throw error;
    });
    return known;
  };
}
