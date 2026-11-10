// Signed fixtures and the disk-backed harness shared by the upgrade audit suites.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expect, vi } from 'vitest';
import type { LicensingConfig } from './licensing-config.js';
import { createLicensingRuntime } from './licensing-runtime.js';
import { createLicensingStore } from './licensing-store.js';
import type { LicenceClaims } from './licensing-verification.js';

export const ISSUED = Date.parse('2026-10-03T01:00:00.000Z') / 1000;
export const DAY = 86_400;
export const device = createHash('sha256').update('upgrade audit computer').digest('base64url');
export const otherDevice = createHash('sha256')
  .update('different audit computer')
  .digest('base64url');
export const pair = generateKeyPairSync('ed25519');
export const keys = {
  upgrade: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
};
export const token = Buffer.alloc(32, 19).toString('base64url');
export const key = 'KD1.synthetic-upgrade-audit';
export const directories: string[] = [];

/** Removes the temporary profiles a suite created; refuses any other folder. */
export async function removeAuditProfiles(): Promise<void> {
  for (const path of directories.splice(0)) {
    if (dirname(path) !== tmpdir() || !basename(path).startsWith('kerfdesk-upgrade-audit-'))
      throw new Error('Refusing to remove an unowned profile.');
    await rm(path, { recursive: true, force: true });
  }
}

export function signed(value: unknown, release = false) {
  const bytes = Buffer.from(JSON.stringify(value));
  const encoding = release ? 'base64' : 'base64url';
  return {
    ...(release ? { schemaVersion: 1, algorithm: 'Ed25519' } : {}),
    keyId: 'upgrade',
    payload: bytes.toString(encoding),
    signature: sign(null, bytes, pair.privateKey).toString(encoding),
  };
}

// A trial checks in every three days (ADR-592). Deadline tests use a trial whose
// last online confirmation was two days before its original expiry.
export const LATE = ISSUED + 28 * DAY;

export function rights(tier: 'paid' | 'trial', confirmedAt = ISSUED): LicenceClaims {
  const expires = tier === 'trial' ? ISSUED + 30 * DAY : null;
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    licenseId: 'upgrade-licence',
    activationId: 'upgrade-seat',
    deviceId: device,
    tier,
    issuedAt: confirmedAt,
    accessExpiresAt: expires,
    updatesUntil: expires ?? ISSUED + 365 * DAY,
    perpetualUpdates: false,
    maxDevices: 3,
  };
}

export function config(version: string, publishedAt = ISSUED - DAY): LicensingConfig {
  return {
    channel: 'commercial',
    apiOrigin: 'https://upgrade-audit.invalid',
    entitlementKeys: keys,
    releaseKeys: keys,
    release: signed(
      {
        schemaVersion: 1,
        product: 'kerfdesk-desktop',
        kind: 'release-identity',
        channel: 'stable',
        version,
        sourceSha: 'c998b4d82971fdacfbb1e2d36cc93c2d30080245',
        sourceRef: 'synthetic-upgrade-audit',
        publishedAt: new Date(publishedAt * 1000).toISOString(),
      },
      true,
    ),
  };
}

// The cryptographic signatures are real. This explicitly fake OS cipher lets
// portable tests exercise real disk/store/runtime handoff. Native Windows
// safeStorage and exact published modules are qualified separately.
export const encode = (value: unknown): Buffer =>
  Buffer.from(Buffer.from(JSON.stringify(value)).map((byte) => byte ^ 0x5a));
export async function harness(tier: 'paid' | 'trial', confirmedAt = ISSUED) {
  const profile = await mkdtemp(join(tmpdir(), 'kerfdesk-upgrade-audit-'));
  directories.push(profile);
  const file = join(profile, 'commercial-licence.v1');
  const store = createLicensingStore({
    userDataPath: profile,
    platform: 'win32',
    secureStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value) => encode(JSON.parse(value)),
      decryptStringAsync: async (value) => ({
        result: value.map((byte) => byte ^ 0x5a).toString(),
        shouldReEncrypt: false,
      }),
    },
  });
  let now = confirmedAt;
  const entitlement = signed(rights(tier, confirmedAt));
  const fetch = vi.fn<(_: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json({ entitlement, activationToken: token }),
  );
  const runtime = (version = '1.0.8', boundDevice = device, publishedAt = ISSUED - DAY) =>
    createLicensingRuntime({
      config: config(version, publishedAt),
      currentVersion: version,
      store,
      deviceId: async () => boundDevice,
      deviceName: 'Synthetic upgrade audit',
      fetch,
      now: () => now * 1000,
    });
  const old = runtime('1.0.7');
  const admitted = tier === 'paid' ? await old.activate(key) : await old.startTrial();
  expect(admitted).toMatchObject({ state: 'ready', edition: 'pro', tier });
  fetch.mockClear();
  fetch.mockRejectedValue(new Error('Synthetic offline boundary; no HTTP is performed.'));
  return { store, file, fetch, runtime, time: (seconds: number) => (now = seconds), entitlement };
}
