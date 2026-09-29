import { createPublicKey, verify } from 'node:crypto';

export type SignedEntitlement = {
  readonly keyId: string;
  readonly payload: string;
  readonly signature: string;
};

export type LicenceClaims = {
  readonly schemaVersion: 1;
  readonly product: 'kerfdesk-desktop';
  readonly licenseId: string;
  readonly activationId: string;
  readonly deviceId: string;
  readonly tier: 'trial' | 'paid' | 'developer';
  readonly issuedAt: number;
  readonly accessExpiresAt: number | null;
  readonly updatesUntil: number | null;
  readonly perpetualUpdates: boolean;
  readonly maxDevices: 3;
};

export type PublicKeys = Readonly<Record<string, string>>;
export type VerifiedRelease = { readonly version: string; readonly publishedAt: number };

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decoded(value: unknown, encoding: 'base64' | 'base64url'): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 65_536) return null;
  const bytes = Buffer.from(value, encoding);
  return bytes.toString(encoding) === value ? bytes : null;
}

function signedPayload(
  value: unknown,
  keys: PublicKeys,
  encoding: 'base64' | 'base64url',
): unknown {
  if (!record(value) || typeof value.keyId !== 'string' || !Object.hasOwn(keys, value.keyId)) {
    return null;
  }
  const payload = decoded(value.payload, encoding);
  const signature = decoded(value.signature, encoding);
  const spki = decoded(keys[value.keyId], 'base64');
  if (payload === null || signature?.length !== 64 || spki === null) return null;
  try {
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, payload, key, signature)) return null;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as unknown;
  } catch {
    return null;
  }
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

export function verifyEntitlement(
  envelope: unknown,
  keys: PublicKeys,
  deviceId: string,
): LicenceClaims | null {
  const value = signedPayload(envelope, keys, 'base64url');
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.product !== 'kerfdesk-desktop' ||
    !identifier(value.licenseId) ||
    !identifier(value.activationId) ||
    value.deviceId !== deviceId ||
    !/^[A-Za-z0-9_-]{43}$/.test(deviceId) ||
    !timestamp(value.issuedAt) ||
    value.maxDevices !== 3
  )
    return null;
  return validRights(value) ? (value as LicenceClaims) : null;
}

function validRights(value: Record<string, unknown>): boolean {
  if (value.tier === 'trial') return validTrial(value);
  if (value.tier === 'paid')
    return (
      value.accessExpiresAt === null &&
      timestamp(value.updatesUntil) &&
      value.perpetualUpdates === false
    );
  return (
    value.tier === 'developer' &&
    value.accessExpiresAt === null &&
    value.updatesUntil === null &&
    value.perpetualUpdates === true
  );
}

function validTrial(value: Record<string, unknown>): boolean {
  return (
    timestamp(value.accessExpiresAt) &&
    timestamp(value.issuedAt) &&
    value.accessExpiresAt > value.issuedAt &&
    value.accessExpiresAt - value.issuedAt <= 30 * 86_400 &&
    value.updatesUntil === value.accessExpiresAt &&
    value.perpetualUpdates === false
  );
}

export function verifyLicenceRelease(
  envelope: unknown,
  keys: PublicKeys,
  kind: 'release-identity' | 'update-manifest' = 'release-identity',
): VerifiedRelease | null {
  if (!record(envelope) || envelope.schemaVersion !== 1 || envelope.algorithm !== 'Ed25519') {
    return null;
  }
  const value = signedPayload(envelope, keys, 'base64');
  if (
    !record(value) ||
    !releaseIdentity(value, kind) ||
    typeof value.version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version) ||
    typeof value.publishedAt !== 'string'
  )
    return null;
  const publishedMs = Date.parse(value.publishedAt);
  if (!canonicalDate(publishedMs, value.publishedAt)) {
    return null;
  }
  return { version: value.version, publishedAt: Math.floor(publishedMs / 1000) };
}

function canonicalDate(value: number, text: string): boolean {
  return Number.isFinite(value) && value > 0 && new Date(value).toISOString() === text;
}

function releaseIdentity(value: Record<string, unknown>, kind: string): boolean {
  return (
    value.schemaVersion === 1 &&
    value.product === 'kerfdesk-desktop' &&
    value.kind === kind &&
    value.channel === 'stable' &&
    typeof value.sourceSha === 'string' &&
    /^[a-f0-9]{40}$/.test(value.sourceSha) &&
    typeof value.sourceRef === 'string' &&
    value.sourceRef.length > 0 &&
    value.sourceRef.length <= 200
  );
}

export function licenceCoversRelease(claims: LicenceClaims, release: VerifiedRelease): boolean {
  return (
    claims.perpetualUpdates ||
    (claims.updatesUntil !== null && release.publishedAt <= claims.updatesUntil)
  );
}
