/**
 * T1-256: real WebCrypto signer for server-side entitlement adapters.
 *
 * T2-89 defined the `ServerEntitlementSigner` interface and T1-255
 * added client-side public-key verification. This module gives a server
 * adapter a production signing implementation while keeping private-key
 * config in a server-only env variable.
 */
import type { ServerEntitlementSigner } from './ServerEntitlementService';
import {
  base64UrlEncode,
  type EntitlementTokenPayload,
  type SignedEntitlementToken,
  type SigningAlg,
} from './SignedEntitlementToken';

export interface EntitlementPrivateKeyConfig {
  readonly kid: string;
  readonly alg: SigningAlg;
  readonly jwk: JsonWebKey;
}

interface CryptoLike {
  readonly subtle: unknown;
}

interface SubtleSignOps {
  importKey(
    format: 'jwk',
    keyData: JsonWebKey,
    algorithm: unknown,
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<unknown>;
  sign(
    algorithm: unknown,
    key: unknown,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
}

type EnvLike = Partial<Record<string, string | undefined>>;

const PRIVATE_KEY_ENV = 'ENTITLEMENT_SIGNING_PRIVATE_JWK';

export function parseEntitlementSigningPrivateKeyConfig(
  raw: string | undefined,
): EntitlementPrivateKeyConfig | null {
  if (raw == null || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isEntitlementPrivateKeyConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createConfiguredServerEntitlementSignerFromEnv(
  env: EnvLike | undefined,
  cryptoImpl: CryptoLike | undefined = globalThis.crypto,
): ServerEntitlementSigner | null {
  const config = parseEntitlementSigningPrivateKeyConfig(env?.[PRIVATE_KEY_ENV]);
  if (config == null || cryptoImpl?.subtle == null) return null;
  return createWebCryptoServerEntitlementSigner(config, cryptoImpl);
}

export function createWebCryptoServerEntitlementSigner(
  config: EntitlementPrivateKeyConfig,
  cryptoImpl: CryptoLike = globalThis.crypto,
): ServerEntitlementSigner {
  let importedKey: Promise<unknown> | null = null;

  return {
    signEntitlement: async (payload: EntitlementTokenPayload): Promise<SignedEntitlementToken> => {
      importedKey ??= subtleOps(cryptoImpl).importKey(
        'jwk',
        config.jwk,
        importAlgorithm(config.alg),
        false,
        ['sign'],
      );
      const payloadBase64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
      const signature = await subtleOps(cryptoImpl).sign(
        signAlgorithm(config.alg),
        await importedKey,
        bytesToArrayBuffer(new TextEncoder().encode(payloadBase64)),
      );
      return {
        payload: payloadBase64,
        signature: base64UrlEncode(new Uint8Array(signature)),
        alg: config.alg,
        kid: config.kid,
      };
    },
  };
}

function isEntitlementPrivateKeyConfig(input: unknown): input is EntitlementPrivateKeyConfig {
  if (input == null || typeof input !== 'object') return false;
  const candidate = input as Partial<EntitlementPrivateKeyConfig>;
  return (
    typeof candidate.kid === 'string' && candidate.kid.length > 0 &&
    candidate.alg === 'ES256' &&
    candidate.jwk != null &&
    typeof candidate.jwk === 'object' &&
    isEs256PrivateJwk(candidate.jwk)
  );
}

function isEs256PrivateJwk(jwk: JsonWebKey): boolean {
  return (
    jwk.kty === 'EC' &&
    jwk.crv === 'P-256' &&
    typeof jwk.x === 'string' &&
    typeof jwk.y === 'string' &&
    typeof jwk.d === 'string' &&
    jwk.d.length > 0
  );
}

function subtleOps(cryptoImpl: CryptoLike): SubtleSignOps {
  return cryptoImpl.subtle as SubtleSignOps;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function importAlgorithm(alg: SigningAlg): EcKeyImportParams | AlgorithmIdentifier {
  switch (alg) {
    case 'ES256':
      return { name: 'ECDSA', namedCurve: 'P-256' };
    case 'EdDSA':
      return { name: 'Ed25519' } as AlgorithmIdentifier;
  }
}

function signAlgorithm(alg: SigningAlg): EcdsaParams | AlgorithmIdentifier {
  switch (alg) {
    case 'ES256':
      return { name: 'ECDSA', hash: 'SHA-256' };
    case 'EdDSA':
      return { name: 'Ed25519' } as AlgorithmIdentifier;
  }
}
