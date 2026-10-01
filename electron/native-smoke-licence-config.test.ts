import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readNativeLicenceQualification,
  readNativeQualificationKey,
} from './native-smoke-licence-config.js';
import { readNativeSmokeConfig } from './native-smoke.js';

const fakeKey = `KD1.test.${'a'.repeat(43)}`;

describe('private native licence qualification configuration', () => {
  it('requires the explicit smoke profile and output even for an offline phase', () => {
    expect(readNativeLicenceQualification([])).toBeUndefined();
    expect(() => readNativeSmokeConfig(['--kerfdesk-native-smoke-licence-phase=offline'])).toThrow(
      'both user-data and result paths',
    );
    expect(
      readNativeLicenceQualification(['--kerfdesk-native-smoke-licence-phase=offline']),
    ).toEqual({ phase: 'offline' });
  });

  it('only permits a private file path for activation', () => {
    expect(() =>
      readNativeLicenceQualification(['--kerfdesk-native-smoke-licence-phase=activate']),
    ).toThrow('absolute private keys file');
    expect(() =>
      readNativeLicenceQualification([
        '--kerfdesk-native-smoke-licence-phase=deactivate',
        `--kerfdesk-native-smoke-key-file=${resolve('private.json')}`,
      ]),
    ).toThrow('Only activation');
  });

  it('selects one issued grant and rejects duplicate, missing and oversized input without contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-qualification-'));
    const keyFile = join(directory, 'private.json');
    const qualification = { phase: 'activate' as const, keyFile, grantId: 'johann' };
    try {
      await writeFile(
        keyFile,
        JSON.stringify({ schemaVersion: 1, grants: [{ grantId: 'johann', licenseKey: fakeKey }] }),
      );
      await expect(readNativeQualificationKey(qualification)).resolves.toBe(fakeKey);
      await expect(readNativeQualificationKey({ phase: 'offline' })).resolves.toBe('');
      for (const input of [
        JSON.stringify({
          schemaVersion: 1,
          grants: [1, 2].map(() => ({ grantId: 'johann', licenseKey: fakeKey })),
        }),
        JSON.stringify({ schemaVersion: 1, grants: [] }),
        fakeKey.repeat(2000),
      ]) {
        await writeFile(keyFile, input);
        await expect(readNativeQualificationKey(qualification)).rejects.toThrow(
          /^The private qualification keys file could not be read$/,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
