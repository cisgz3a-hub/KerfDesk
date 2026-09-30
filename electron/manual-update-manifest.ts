import { readFileSync } from 'node:fs';
import {
  MANUAL_DOWNLOAD_LATEST_URL,
  MANUAL_DOWNLOAD_LIMIT,
  verifyManualDownload,
  type ManualDownload,
} from '../public/desktop-manual-download.mjs';
import { readBoundedManifest } from '../public/desktop-release-manifest.mjs';
import type { LicensingConfig } from './licensing-config.js';
import { record, verifyLicenceRelease, type PublicKeys } from './licensing-verification.js';

export type ManualCandidate = { readonly envelope: string; readonly release: ManualDownload };
export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>;

export function manualReleaseKeySet(keys: PublicKeys): unknown {
  return {
    schemaVersion: 1,
    keys: Object.entries(keys).map(([keyId, publicKeySpki]) => ({
      keyId,
      publicKeySpki,
      algorithm: 'Ed25519',
      channel: 'stable',
    })),
  };
}

/** Independent package anchor, never keys supplied by a downloaded manifest. */
export function pinnedStableReleaseKeys(): PublicKeys {
  const value: unknown = JSON.parse(
    readFileSync(new URL('../public/desktop-release-keys.json', import.meta.url), 'utf8'),
  );
  if (!record(value) || !Array.isArray(value.keys)) throw new Error('Missing release anchors');
  const keys: Record<string, string> = {};
  for (const key of value.keys as unknown[]) {
    if (!record(key) || key.channel !== 'stable') continue;
    if (
      key.algorithm !== 'Ed25519' ||
      typeof key.keyId !== 'string' ||
      typeof key.publicKeySpki !== 'string' ||
      Object.hasOwn(keys, key.keyId)
    )
      throw new Error('Invalid release anchor');
    keys[key.keyId] = key.publicKeySpki;
  }
  if (Object.keys(keys).length === 0) throw new Error('Missing stable release anchor');
  return keys;
}

export function manualUpdatesOffered(
  config: LicensingConfig,
  build: {
    readonly packaged: boolean;
    readonly platform: string;
    readonly arch: string;
    readonly version: string;
  },
  keys: PublicKeys,
): boolean {
  if (
    !build.packaged ||
    build.platform !== 'win32' ||
    build.arch !== 'x64' ||
    config.channel !== 'commercial' ||
    config.manualUpdates !== true ||
    config.sandbox === true
  )
    return false;
  const entries = (value: PublicKeys): string => JSON.stringify(Object.entries(value).sort());
  if (entries(keys) !== entries(config.releaseKeys)) return false;
  return verifyLicenceRelease(config.release, keys)?.version === build.version;
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    const x = a[index];
    const y = b[index];
    if (x !== undefined && y !== undefined && x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export async function fetchManualCandidate(
  fetch: UpdateFetch,
  keys: PublicKeys,
  now: number,
): Promise<ManualCandidate | null> {
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(MANUAL_DOWNLOAD_LATEST_URL, {
    signal,
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (response.redirected || (response.url !== '' && response.url !== MANUAL_DOWNLOAD_LATEST_URL))
    throw new Error('Unexpected update destination');
  const envelope = await readBoundedManifest(response, MANUAL_DOWNLOAD_LIMIT);
  return {
    envelope,
    release: await verifyManualDownload(envelope, manualReleaseKeySet(keys), now),
  };
}
