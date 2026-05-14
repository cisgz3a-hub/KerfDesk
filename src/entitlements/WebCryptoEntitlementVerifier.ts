/**
 * T1-255: real WebCrypto verifier for signed entitlement tokens.
 *
 * T2-90 introduced the `EntitlementVerifier` interface; T1-254 made
 * `EntitlementService` depend on that verifier for local cache authority.
 * This module closes the next production gap by providing an actual
 * public-key verifier that can be configured from build/runtime env without
 * shipping private keys.
 */
import {
  base64UrlDecode,
  type EntitlementVerifier,
  type SigningAlg,
} from './SignedEntitlementToken';

export interface EntitlementPublicKeyConfig {
  readonly kid: string;
  readonly alg: SigningAlg;
  readonly jwk: JsonWebKey;
}

interface CryptoLike {
  readonly subtle: unknown;
}

interface SubtleVerifyOps {
  importKey(
    format: 'jwk',
    keyData: JsonWebKey,
    algorithm: unknown,
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<unknown>;
  verify(
    algorithm: unknown,
    key: unknown,
    signature: ArrayBuffer,
    data: ArrayBuffer,
  ): Promise<boolean>;
}

type EnvLike = Partial<Record<string, string | undefined>>;

const KEY_ENV = 'VITE_ENTITLEMENT_PUBLIC_KEYS_JWK';

export function parseEntitlementPublicKeyConfig(raw: string | undefined): EntitlementPublicKeyConfig[] {
  if (raw == null || raw.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter(isEntitlementPublicKeyConfig);
  } catch {
    return [];
  }
}

export function createConfiguredEntitlementVerifierFromEnv(
  env: EnvLike | undefined,
  cryptoImpl: CryptoLike | undefined = globalThis.crypto,
): EntitlementVerifier | null {
  const configs = parseEntitlementPublicKeyConfig(env?.[KEY_ENV]);
  if (configs.length === 0 || cryptoImpl?.subtle == null) return null;
  return createWebCryptoEntitlementVerifier(configs, cryptoImpl);
}

export function createWebCryptoEntitlementVerifier(
  configs: readonly EntitlementPublicKeyConfig[],
  cryptoImpl: CryptoLike = globalThis.crypto,
): EntitlementVerifier {
  const uniqueConfigs = dedupeConfigs(configs);
  const keyCache = new Map<string, Promise<unknown>>();

  return {
    knownKids: () => uniqueConfigs.map((config) => config.kid),
    verifySignature: async ({ alg, kid, payloadBase64, signatureBase64 }) => {
      const config = uniqueConfigs.find((candidate) =>
        candidate.kid === kid && candidate.alg === alg);
      if (config == null) return false;

      const key = await importVerifyKey(config, cryptoImpl, keyCache);
      const data = bytesToArrayBuffer(new TextEncoder().encode(payloadBase64));
      const signature = bytesToArrayBuffer(base64UrlDecode(signatureBase64));
      return await subtleOps(cryptoImpl).verify(
        verifyAlgorithm(config.alg),
        key,
        signature,
        data,
      );
    },
  };
}

function dedupeConfigs(
  configs: readonly EntitlementPublicKeyConfig[],
): EntitlementPublicKeyConfig[] {
  const out: EntitlementPublicKeyConfig[] = [];
  const seen = new Set<string>();
  for (const config of configs) {
    const key = `${config.alg}:${config.kid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(config);
  }
  return out;
}

function isEntitlementPublicKeyConfig(input: unknown): input is EntitlementPublicKeyConfig {
  if (input == null || typeof input !== 'object') return false;
  const candidate = input as Partial<EntitlementPublicKeyConfig>;
  return (
    typeof candidate.kid === 'string' && candidate.kid.length > 0 &&
    (candidate.alg === 'ES256' || candidate.alg === 'EdDSA') &&
    candidate.jwk != null &&
    typeof candidate.jwk === 'object'
  );
}

function importVerifyKey(
  config: EntitlementPublicKeyConfig,
  cryptoImpl: CryptoLike,
  keyCache: Map<string, Promise<unknown>>,
): Promise<unknown> {
  const cacheKey = `${config.alg}:${config.kid}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const imported = subtleOps(cryptoImpl).importKey(
    'jwk',
    config.jwk,
    importAlgorithm(config.alg),
    false,
    ['verify'],
  );
  keyCache.set(cacheKey, imported);
  return imported;
}

function subtleOps(cryptoImpl: CryptoLike): SubtleVerifyOps {
  return cryptoImpl.subtle as SubtleVerifyOps;
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

function verifyAlgorithm(alg: SigningAlg): EcdsaParams | AlgorithmIdentifier {
  switch (alg) {
    case 'ES256':
      return { name: 'ECDSA', hash: 'SHA-256' };
    case 'EdDSA':
      return { name: 'Ed25519' } as AlgorithmIdentifier;
  }
}
