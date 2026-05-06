/**
 * T2-90: signed local entitlement token with public-key
 * verification. Pre-T2-90 the local cache at
 * `src/entitlements/EntitlementService.ts:238-250`
 * (`setCachedLicense`) wrote raw JSON. A user could edit
 * `laserforge_license_cache` in IndexedDB to
 * `{"code":"WHATEVER","name":"PRO User","validatedAt":9999999999999,
 * "valid":true}` and influence offline behaviour.
 *
 * Audit 5A Critical 3 + Required Priority 3.
 *
 * T2-90 ships the typed signed-token shape + format validators +
 * base64url codec + replay/expiry/clock-skew checks + a verifier
 * stub that takes an `EntitlementVerifier` interface (so the real
 * Ed25519 / ECDSA WebCrypto wiring lands in T2-90-followup once
 * T2-89's server is up and a real public key is embedded). This
 * MVP gives `EntitlementService` typed cache I/O + replay defence
 * even before the public-key crypto is wired.
 */

export type SigningAlg = 'EdDSA' | 'ES256';

/**
 * Outer envelope. `payload` is base64url(JSON(EntitlementTokenPayload));
 * `signature` is base64url(sig); `alg` + `kid` are public so the
 * verifier can pick the right key.
 */
export interface SignedEntitlementToken {
  readonly payload: string;
  readonly signature: string;
  readonly alg: SigningAlg;
  readonly kid: string;
}

/**
 * Decoded payload. Mirrors T2-89's server token shape — fields
 * here are the contract the client trusts.
 */
export interface EntitlementTokenPayload {
  readonly sub: string;
  readonly tier: 'free' | 'paid' | 'tester';
  readonly features: readonly string[];
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly deviceId?: string;
}

/** Reasons a verification can fail. */
export type VerifyFailureReason =
  | 'malformed-envelope'
  | 'malformed-payload'
  | 'unsupported-alg'
  | 'unknown-kid'
  | 'bad-signature'
  | 'expired'
  | 'not-yet-valid'
  | 'clock-skew-exceeded'
  | 'replay-detected'
  | 'device-mismatch';

export type VerifyResult =
  | { ok: true; payload: EntitlementTokenPayload }
  | { ok: false; reason: VerifyFailureReason; detail?: string };

/** base64url codec (RFC 7515 §2). Pure; no Buffer dependency. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pure shape check on the outer envelope. */
export function isWellFormedToken(input: unknown): input is SignedEntitlementToken {
  if (!input || typeof input !== 'object') return false;
  const t = input as Record<string, unknown>;
  return (
    typeof t.payload === 'string' && t.payload.length > 0 &&
    typeof t.signature === 'string' && t.signature.length > 0 &&
    (t.alg === 'EdDSA' || t.alg === 'ES256') &&
    typeof t.kid === 'string' && t.kid.length > 0
  );
}

/** Pure shape check on the decoded payload. */
export function isWellFormedPayload(p: unknown): p is EntitlementTokenPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.sub === 'string' && o.sub.length > 0 &&
    (o.tier === 'free' || o.tier === 'paid' || o.tier === 'tester') &&
    Array.isArray(o.features) && o.features.every(f => typeof f === 'string') &&
    typeof o.iat === 'number' && typeof o.exp === 'number' &&
    typeof o.jti === 'string' && o.jti.length > 0 &&
    (o.deviceId === undefined || typeof o.deviceId === 'string')
  );
}

/** Decode envelope.payload → EntitlementTokenPayload (no signature check). */
export function decodePayload(token: SignedEntitlementToken): EntitlementTokenPayload | null {
  let json: unknown;
  try {
    const bytes = base64UrlDecode(token.payload);
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return isWellFormedPayload(json) ? json : null;
}

/**
 * Verifier interface — the production implementation calls
 * WebCrypto subtle.verify with the embedded public key. Tests +
 * the MVP can pass a deterministic stub.
 */
export interface EntitlementVerifier {
  /** Returns true iff the signature over `payloadBase64` is valid for `kid`+`alg`. */
  verifySignature(opts: {
    alg: SigningAlg;
    kid: string;
    payloadBase64: string;
    signatureBase64: string;
  }): Promise<boolean>;

  /** Set of acceptable kids (key rotation). Used to detect 'unknown-kid'. */
  knownKids(): readonly string[];
}

/** A simple replay-protection store: jtis we've already accepted. */
export interface JtiSeenStore {
  has(jti: string): boolean;
  add(jti: string): void;
}

export interface VerifyOptions {
  readonly token: unknown;
  readonly verifier: EntitlementVerifier;
  readonly now: number;
  /** Acceptable clock skew window in ms; default 5 min. */
  readonly maxClockSkewMs?: number;
  /** Optional replay-detection store. */
  readonly seenJtis?: JtiSeenStore;
  /** Default 'detect'. Use 'ignore' for idempotent local-cache reads. */
  readonly replayMode?: 'detect' | 'ignore';
  /** Optional device binding. When set, payload.deviceId must match. */
  readonly expectedDeviceId?: string;
}

/**
 * Pure-ish verifier (signature check is async; everything else is
 * pure). Returns the typed VerifyResult so the cache-read path
 * has full diagnostic information instead of "valid: true|false".
 *
 * Order: shape → unsupported-alg → unknown-kid → signature →
 * payload-decode → expiry → device-binding → replay.
 */
export async function verifyEntitlementToken(opts: VerifyOptions): Promise<VerifyResult> {
  const skew = opts.maxClockSkewMs ?? 5 * 60 * 1000;
  if (!isWellFormedToken(opts.token)) {
    return { ok: false, reason: 'malformed-envelope' };
  }
  const token = opts.token;
  if (token.alg !== 'EdDSA' && token.alg !== 'ES256') {
    return { ok: false, reason: 'unsupported-alg', detail: String(token.alg) };
  }
  if (!opts.verifier.knownKids().includes(token.kid)) {
    return { ok: false, reason: 'unknown-kid', detail: token.kid };
  }
  const sigOk = await opts.verifier.verifySignature({
    alg: token.alg,
    kid: token.kid,
    payloadBase64: token.payload,
    signatureBase64: token.signature,
  });
  if (!sigOk) {
    return { ok: false, reason: 'bad-signature' };
  }
  const payload = decodePayload(token);
  if (payload == null) {
    return { ok: false, reason: 'malformed-payload' };
  }
  if (opts.now > payload.exp + skew) {
    return { ok: false, reason: 'expired' };
  }
  if (opts.now < payload.iat - skew) {
    return { ok: false, reason: 'not-yet-valid' };
  }
  if (Math.abs(opts.now - payload.iat) > 365 * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: 'clock-skew-exceeded', detail: 'iat more than a year off' };
  }
  if (opts.expectedDeviceId !== undefined && payload.deviceId !== opts.expectedDeviceId) {
    return { ok: false, reason: 'device-mismatch' };
  }
  const replayMode = opts.replayMode ?? 'detect';
  if (replayMode === 'detect' && opts.seenJtis != null && opts.seenJtis.has(payload.jti)) {
    return { ok: false, reason: 'replay-detected' };
  }
  if (replayMode === 'detect' && opts.seenJtis != null) opts.seenJtis.add(payload.jti);
  return { ok: true, payload };
}

/**
 * In-memory `JtiSeenStore` for tests + the MVP. Production wiring
 * persists this to storage with bounded retention.
 */
export class InMemoryJtiStore implements JtiSeenStore {
  private readonly _seen = new Set<string>();
  has(jti: string): boolean { return this._seen.has(jti); }
  add(jti: string): void { this._seen.add(jti); }
  size(): number { return this._seen.size; }
}

/** User-facing message per failure reason. */
export function verifyFailureMessage(reason: VerifyFailureReason): string {
  switch (reason) {
    case 'malformed-envelope':   return 'License cache is malformed. Re-authenticate to refresh.';
    case 'malformed-payload':    return 'License payload is malformed. Re-authenticate to refresh.';
    case 'unsupported-alg':      return 'License uses an unsupported signature algorithm. Update LaserForge.';
    case 'unknown-kid':          return 'License signed with an unknown key. Re-authenticate to refresh.';
    case 'bad-signature':        return 'License signature is invalid. Tampered or corrupt cache.';
    case 'expired':              return 'License has expired. Re-authenticate to refresh.';
    case 'not-yet-valid':        return 'License is not yet valid. Check your system clock.';
    case 'clock-skew-exceeded':  return 'System clock is too far off — license cannot be verified.';
    case 'replay-detected':      return 'License token replay detected. Re-authenticate to refresh.';
    case 'device-mismatch':      return 'License is bound to a different device.';
  }
}
