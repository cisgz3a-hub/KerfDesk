import { readFileSync } from 'node:fs';
import {
  MANUAL_DOWNLOAD_LATEST_URL,
  MANUAL_DOWNLOAD_LIMIT,
  verifyManualDownload,
  type ManualDownload,
} from '../public/desktop-manual-download.mjs';
import {
  DOWNLOAD_PLATFORMS,
  PLATFORM_DOWNLOAD_LIMIT,
  platformLatestUrl,
  verifyPlatformDownload,
  type DownloadPlatform,
  type PlatformDownload,
} from '../public/desktop-platform-download.mjs';
import { readBoundedManifest } from '../public/desktop-release-manifest.mjs';
import type { LicensingConfig } from './licensing-config.js';
import { record, verifyLicenceRelease, type PublicKeys } from './licensing-verification.js';

export type ManualCandidate = { readonly envelope: string; readonly release: ManualDownload };
export type PlatformCandidate = { readonly envelope: string; readonly release: PlatformDownload };
/** Which signed download document a packaged commercial build reads (ADR-613). */
export type ManualPlatform = 'windows' | DownloadPlatform;
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

/** Windows x64 reads latest.json; macOS (x64, arm64) and Linux x64 read their own document. */
export function manualUpdatePlatform(platform: string, arch: string): ManualPlatform | null {
  if (platform === 'win32' && arch === 'x64') return 'windows';
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) return 'macos';
  if (platform === 'linux' && arch === 'x64') return 'linux';
  return null;
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
    manualUpdatePlatform(build.platform, build.arch) === null ||
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

/** The newest verified release for this system, or null when none is published. */
export async function fetchPlatformCandidate(
  fetch: UpdateFetch,
  keys: PublicKeys,
  platform: DownloadPlatform,
  now: number,
): Promise<PlatformCandidate | null> {
  const url = platformLatestUrl(platform);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (response.redirected || (response.url !== '' && response.url !== url))
    throw new Error('Unexpected update destination');
  const envelope = await readBoundedManifest(response, PLATFORM_DOWNLOAD_LIMIT);
  return {
    envelope,
    release: await verifyPlatformDownload(envelope, manualReleaseKeySet(keys), platform, now),
  };
}

/**
 * The version and date of any verified manual download document, for licence
 * update coverage: the Windows one, or a macOS or Linux one.
 */
export async function verifyAnyManualDownload(
  envelope: string,
  keySet: unknown,
  now: number,
): Promise<ManualDownload | PlatformDownload> {
  try {
    return await verifyManualDownload(envelope, keySet, now);
  } catch (error) {
    for (const platform of DOWNLOAD_PLATFORMS) {
      try {
        return await verifyPlatformDownload(envelope, keySet, platform, now);
      } catch {
        // Not this system's document either.
      }
    }
    throw error;
  }
}
