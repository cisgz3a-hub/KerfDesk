import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { windowsRegistryCommand } from './windows-registry-command.js';

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
      await exec(file === 'reg.exe' ? windowsRegistryCommand() : file, [...args], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 64 * 1024,
      })
    ).stdout,
};

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
