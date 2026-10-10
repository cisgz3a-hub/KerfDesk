import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import type { LicensingConfig } from './licensing-config';
import type { LicenceRecord } from './licensing-store';
import type { LicenceClaims } from './licensing-verification';

const pair = generateKeyPairSync('ed25519');
export const keys = {
  test: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
};
export const NOW = Date.parse('2026-09-28T00:00:00.000Z');
export const device = createHash('sha256').update('test-device').digest('base64url');
export const token = Buffer.alloc(32, 7).toString('base64url');
export const checkoutUrl = `https://kerfdesk.com/buy.html?_ptxn=txn_${'a'.repeat(26)}`;

export function envelope(value: unknown, release = false) {
  const payload = Buffer.from(JSON.stringify(value));
  const encoding = release ? 'base64' : 'base64url';
  return {
    ...(release ? { schemaVersion: 1, algorithm: 'Ed25519' } : {}),
    keyId: 'test',
    payload: payload.toString(encoding),
    signature: sign(null, payload, pair.privateKey).toString(encoding),
  };
}
export function claims(patch: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    licenseId: 'license-1',
    activationId: 'activation-1',
    deviceId: device,
    tier: 'paid',
    issuedAt: NOW / 1000,
    accessExpiresAt: null,
    updatesUntil: NOW / 1000 + 365 * 86_400,
    perpetualUpdates: false,
    maxDevices: 3,
    ...patch,
  };
}
export function release(
  kind: 'release-identity' | 'update-manifest' = 'release-identity',
  publishedAt = '2026-09-01T00:00:00.000Z',
  version = '1.0.0',
) {
  return envelope(
    {
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      kind,
      channel: 'stable',
      version,
      sourceSha: 'a'.repeat(40),
      sourceRef: 'refs/tags/v1.0.0',
      publishedAt,
    },
    true,
  );
}
export function harness(initial: LicenceRecord | null = null) {
  let saved = initial;
  let clock = NOW;
  const store = {
    read: vi.fn(async (): Promise<LicenceRecord | null> => saved),
    write: vi.fn(async (value: LicenceRecord) => {
      saved = structuredClone(value);
    }),
    reset: vi.fn(async () => {
      saved = null;
    }),
  };
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ entitlement: envelope(claims()), activationToken: token }),
  );
  const openCheckout = vi.fn(async (_url: string) => undefined);
  const config: LicensingConfig = {
    channel: 'commercial',
    apiOrigin: 'https://licensing.example',
    entitlementKeys: keys,
    releaseKeys: keys,
    release: release(),
  };
  const options = {
    config,
    currentVersion: '1.0.0',
    store,
    deviceId: async () => device,
    deviceName: 'Test device',
    fetch,
    openCheckout,
    now: () => clock,
  };
  return {
    runtime: createLicensingRuntime(options),
    options,
    store,
    fetch,
    openCheckout,
    saved: () => saved,
    clock: (value: number) => {
      clock = value;
    },
  };
}
export function saved(claim: LicenceClaims = claims()): LicenceRecord {
  return {
    schemaVersion: 1,
    lastSeenAt: NOW / 1000,
    credential: { entitlement: envelope(claim), activationToken: token },
  };
}
export function trialClaims(patch: Partial<LicenceClaims> = {}): LicenceClaims {
  const issuedAt = patch.issuedAt ?? NOW / 1000;
  const expiry = issuedAt + 20 * 86_400;
  return claims({ tier: 'trial', accessExpiresAt: expiry, updatesUntil: expiry, ...patch });
}
export function grant(claim: LicenceClaims = claims()): Response {
  return Response.json({ entitlement: envelope(claim), activationToken: token });
}
