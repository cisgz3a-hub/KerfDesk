import { open, type FileHandle } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export type NativeLicencePhase = 'activate' | 'offline' | 'deactivate';
export type NativeLicenceQualification = {
  readonly phase: NativeLicencePhase;
  readonly keyFile?: string;
  readonly grantId?: string;
};

export function readNativeLicenceQualification(
  argv: ReadonlyArray<string>,
): NativeLicenceQualification | undefined {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const phase = value('--kerfdesk-native-smoke-licence-phase');
  const keyFile = value('--kerfdesk-native-smoke-key-file');
  const grantId = value('--kerfdesk-native-smoke-grant-id');
  if (phase === undefined && keyFile === undefined && grantId === undefined) return undefined;
  if (!['activate', 'offline', 'deactivate'].includes(phase ?? ''))
    throw new Error('Invalid native licence qualification phase');
  if (phase === 'activate') return activationQualification(keyFile, grantId);
  if (keyFile !== undefined || grantId !== undefined)
    throw new Error('Only activation qualification may read a keys file');
  return { phase: phase as NativeLicencePhase };
}

function activationQualification(
  keyFile: string | undefined,
  grantId: string | undefined,
): NativeLicenceQualification {
  if (
    keyFile === undefined ||
    !isAbsolute(keyFile) ||
    grantId === undefined ||
    !/^[a-z0-9_-]{1,100}$/.test(grantId)
  )
    throw new Error('Activation qualification requires an absolute private keys file and grant ID');
  return { phase: 'activate', keyFile: resolve(keyFile), grantId };
}

async function boundedInput(handle: FileHandle): Promise<string> {
  if (!(await handle.stat()).isFile()) throw new Error();
  const buffer = Buffer.alloc(65_537);
  let bytesRead = 0;
  while (bytesRead < buffer.length) {
    const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
    if (read.bytesRead === 0) break;
    bytesRead += read.bytesRead;
  }
  if (bytesRead > 65_536) throw new Error();
  return buffer.subarray(0, bytesRead).toString('utf8');
}

/** Read only the selected issued key, with a strict bound and no content in errors. */
export async function readNativeQualificationKey(
  qualification: NativeLicenceQualification,
): Promise<string> {
  if (qualification.phase !== 'activate' || qualification.keyFile === undefined) return '';
  try {
    const handle = await open(qualification.keyFile, 'r');
    try {
      const document = JSON.parse(await boundedInput(handle)) as {
        schemaVersion?: unknown;
        grants?: ReadonlyArray<{ grantId?: unknown; licenseKey?: unknown }>;
      };
      const grants = document.grants;
      if (document.schemaVersion !== 1 || !Array.isArray(grants)) throw new Error();
      const matches = grants.filter((grant) => grant.grantId === qualification.grantId);
      const key = matches.length === 1 ? matches[0]?.licenseKey : null;
      if (typeof key !== 'string' || !/^KD1\.[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9_-]{43}$/.test(key))
        throw new Error();
      return key;
    } finally {
      await handle.close();
    }
  } catch {
    throw new Error('The private qualification keys file could not be read');
  }
}
