import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { record, type PublicKeys } from './licensing-verification.js';
import { hasSandboxMarker, isSandboxMetadata } from '../public/desktop-sandbox-contract.mjs';

export type LicensingConfig =
  | { readonly channel: 'free' }
  | { readonly channel: 'invalid'; readonly sandbox?: true }
  | {
      readonly channel: 'commercial';
      readonly apiOrigin: string;
      readonly entitlementKeys: PublicKeys;
      readonly releaseKeys: PublicKeys;
      readonly release: unknown;
      readonly sandbox?: true;
      readonly manualUpdates?: true;
    };

function publicKeys(value: unknown): value is PublicKeys {
  return (
    record(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).length <= 8 &&
    Object.entries(value).every(
      ([key, spki]) =>
        /^[A-Za-z0-9_-]{1,80}$/.test(key) && typeof spki === 'string' && spki.length < 1024,
    )
  );
}

export function licensingConfigFromMetadata(metadata: unknown): LicensingConfig {
  if (!record(metadata)) return { channel: 'invalid' };
  const sandbox = hasSandboxMarker(metadata);
  if (sandbox && !isSandboxMetadata(metadata)) return { channel: 'invalid', sandbox: true };
  if (!Object.hasOwn(metadata, 'kerfdeskCommercialLicense')) return { channel: 'free' };
  const value = metadata.kerfdeskCommercialLicense;
  if (
    !record(value) ||
    value.schema !== 1 ||
    typeof value.apiOrigin !== 'string' ||
    !publicKeys(value.entitlementKeys) ||
    !publicKeys(value.releaseKeys)
  )
    return { channel: 'invalid' };
  if (!httpsOrigin(value.apiOrigin)) return { channel: 'invalid' };
  return {
    channel: 'commercial',
    apiOrigin: value.apiOrigin,
    entitlementKeys: value.entitlementKeys,
    releaseKeys: value.releaseKeys,
    release: value.release,
    ...(sandbox ? { sandbox: true as const } : {}),
    ...manualMetadata(metadata, value.apiOrigin, sandbox),
  };
}

function manualMetadata(
  metadata: Record<string, unknown>,
  origin: string,
  sandbox: boolean,
): { readonly manualUpdates?: true } {
  return !sandbox &&
    origin === 'https://license.kerfdesk.com' &&
    metadata.kerfdeskUnsignedInstaller === true &&
    metadata.kerfdeskUpdateChannelTrusted === false &&
    metadata.kerfdeskDesktopReleaseChannel === 'commercial-unsigned'
    ? { manualUpdates: true }
    : {};
}

function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/** Read only from the packaged app, never environment or a network response. */
export function readLicensingConfig(appPath: string): LicensingConfig {
  try {
    return licensingConfigFromMetadata(
      JSON.parse(readFileSync(join(appPath, 'package.json'), 'utf8')),
    );
  } catch {
    return { channel: 'invalid' };
  }
}
