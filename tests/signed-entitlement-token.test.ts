/**
 * T2-90: signed local entitlement token. Pre-T2-90 the local
 * cache was raw JSON — a user could edit IndexedDB to forge a
 * "valid:true" license.
 *
 * Run: npx tsx tests/signed-entitlement-token.test.ts
 */
import {
  base64UrlEncode,
  base64UrlDecode,
  isWellFormedToken,
  isWellFormedPayload,
  decodePayload,
  verifyEntitlementToken,
  verifyFailureMessage,
  InMemoryJtiStore,
  type SignedEntitlementToken,
  type EntitlementTokenPayload,
  type EntitlementVerifier,
  type VerifyFailureReason,
} from '../src/entitlements/SignedEntitlementToken';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-90 signed entitlement token ===\n');

/** Stub verifier: trusts a kid set + accepts/rejects per signature literal. */
function stubVerifier(opts: {
  knownKids: readonly string[];
  acceptSignaturePrefix?: string;
}): EntitlementVerifier {
  return {
    knownKids: () => opts.knownKids,
    verifySignature: async ({ signatureBase64 }) => {
      if (opts.acceptSignaturePrefix == null) return true;
      return signatureBase64.startsWith(opts.acceptSignaturePrefix);
    },
  };
}

function buildPayload(overrides: Partial<EntitlementTokenPayload> = {}): EntitlementTokenPayload {
  return {
    sub: 'user-1',
    tier: 'paid',
    features: ['compile', 'export'],
    iat: 1000,
    exp: 100000,
    jti: 'tok-1',
    ...overrides,
  };
}

function buildToken(overrides: Partial<SignedEntitlementToken> = {}, payload?: EntitlementTokenPayload): SignedEntitlementToken {
  const p = payload ?? buildPayload();
  const payloadJson = JSON.stringify(p);
  const payloadEncoded = base64UrlEncode(new TextEncoder().encode(payloadJson));
  return {
    payload: payloadEncoded,
    signature: 'sig-good',
    alg: 'EdDSA',
    kid: 'kid-1',
    ...overrides,
  };
}

void (async () => {

// 1. base64url round-trip
{
  const data = new Uint8Array([1, 2, 3, 4, 250, 200, 100]);
  const round = base64UrlDecode(base64UrlEncode(data));
  assert(round.length === data.length, `length preserved`);
  for (let i = 0; i < data.length; i++) {
    assert(round[i] === data[i], `byte ${i}`);
  }
}

// 2. base64url has no '+', '/', or '=' chars
{
  const data = new Uint8Array(50).fill(0xff);
  const enc = base64UrlEncode(data);
  assert(!enc.includes('+'), `no +`);
  assert(!enc.includes('/'), `no /`);
  assert(!enc.includes('='), `no =`);
}

// 3. isWellFormedToken: valid + each invalid shape
{
  assert(isWellFormedToken(buildToken()), `valid token`);
  assert(!isWellFormedToken(null), `null → invalid`);
  assert(!isWellFormedToken({}), `empty → invalid`);
  assert(!isWellFormedToken({ payload: '', signature: 's', alg: 'EdDSA', kid: 'k' }),
    `empty payload → invalid`);
  assert(!isWellFormedToken({ payload: 'p', signature: 's', alg: 'XYZ', kid: 'k' }),
    `unknown alg → invalid`);
}

// 4. isWellFormedPayload: each invalid shape
{
  assert(isWellFormedPayload(buildPayload()), `valid payload`);
  assert(!isWellFormedPayload({ ...buildPayload(), tier: 'royal' as 'paid' }), `bad tier`);
  assert(!isWellFormedPayload({ ...buildPayload(), features: 'compile' as unknown as string[] }), `non-array features`);
  assert(!isWellFormedPayload({ ...buildPayload(), iat: 'now' as unknown as number }), `non-number iat`);
}

// 5. decodePayload: round-trips a valid token
{
  const p = buildPayload();
  const t = buildToken({}, p);
  const decoded = decodePayload(t);
  assert(decoded !== null, `decoded`);
  assert(decoded?.sub === p.sub && decoded?.jti === p.jti, `fields preserved`);
}

// 6. decodePayload: tampered base64 → null
{
  const t = buildToken({ payload: '!!!not-base64-url!!!' });
  assert(decodePayload(t) === null, `tampered → null`);
}

// 7. verify happy path
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const r = await verifyEntitlementToken({
    token: buildToken(),
    verifier: v,
    now: 50000,
  });
  assert(r.ok, `ok`);
  if (r.ok) assert(r.payload.sub === 'user-1', `payload returned`);
}

// 8. malformed envelope
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const r = await verifyEntitlementToken({ token: { foo: 'bar' }, verifier: v, now: 50000 });
  assert(!r.ok && r.reason === 'malformed-envelope', `malformed-envelope`);
}

// 9. unknown kid
{
  const v = stubVerifier({ knownKids: ['kid-other'] });
  const r = await verifyEntitlementToken({
    token: buildToken({ kid: 'kid-1' }), verifier: v, now: 50000,
  });
  assert(!r.ok && r.reason === 'unknown-kid', `unknown-kid`);
}

// 10. bad signature
{
  const v = stubVerifier({ knownKids: ['kid-1'], acceptSignaturePrefix: 'sig-good' });
  const r = await verifyEntitlementToken({
    token: buildToken({ signature: 'sig-bad' }), verifier: v, now: 50000,
  });
  assert(!r.ok && r.reason === 'bad-signature', `bad-signature`);
}

// 11. malformed payload (signature OK but payload not parseable as JSON)
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const t = buildToken({
    payload: base64UrlEncode(new TextEncoder().encode('not-json')),
  });
  const r = await verifyEntitlementToken({ token: t, verifier: v, now: 50000 });
  assert(!r.ok && r.reason === 'malformed-payload', `malformed-payload`);
}

// 12. expired (now > exp + skew)
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const r = await verifyEntitlementToken({
    token: buildToken({}, buildPayload({ iat: 1000, exp: 2000 })),
    verifier: v,
    now: 2000 + 5 * 60 * 1000 + 1,
  });
  assert(!r.ok && r.reason === 'expired', `expired`);
}

// 13. expired with skew tolerance: within 5 min of exp → still ok
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const r = await verifyEntitlementToken({
    token: buildToken({}, buildPayload({ iat: 1000, exp: 2000 })),
    verifier: v,
    now: 2000 + 60 * 1000,  // 1 min past exp
  });
  assert(r.ok, `1 min past exp accepted (skew tolerance)`);
}

// 14. not-yet-valid (now << iat by more than skew)
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  // iat 1_000_000ms in the future from now=0; skew=5min=300_000ms
  const r = await verifyEntitlementToken({
    token: buildToken({}, buildPayload({ iat: 1_000_000, exp: 2_000_000 })),
    verifier: v,
    now: 0,
  });
  assert(!r.ok && r.reason === 'not-yet-valid', `not-yet-valid`);
}

// 15. clock-skew-exceeded (iat far future)
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const r = await verifyEntitlementToken({
    token: buildToken({}, buildPayload({ iat: 999_999_999_999, exp: 999_999_999_999 + 10000 })),
    verifier: v,
    now: 50000,
  });
  // Expect either not-yet-valid or clock-skew-exceeded — both protect.
  assert(!r.ok, `far-future iat blocked`);
}

// 16. device-mismatch
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const r = await verifyEntitlementToken({
    token: buildToken({}, buildPayload({ deviceId: 'device-a' })),
    verifier: v,
    now: 50000,
    expectedDeviceId: 'device-b',
  });
  assert(!r.ok && r.reason === 'device-mismatch', `device-mismatch`);
}

// 17. device match: ok
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const r = await verifyEntitlementToken({
    token: buildToken({}, buildPayload({ deviceId: 'device-a' })),
    verifier: v,
    now: 50000,
    expectedDeviceId: 'device-a',
  });
  assert(r.ok, `same device → ok`);
}

// 18. replay detection: 1st verify ok, 2nd same jti → replay
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const seen = new InMemoryJtiStore();
  const t = buildToken();
  const r1 = await verifyEntitlementToken({ token: t, verifier: v, now: 50000, seenJtis: seen });
  assert(r1.ok, `1st ok`);
  const r2 = await verifyEntitlementToken({ token: t, verifier: v, now: 50000, seenJtis: seen });
  assert(!r2.ok && r2.reason === 'replay-detected', `2nd → replay-detected`);
}

// 19. replay detection: different jtis both succeed
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const seen = new InMemoryJtiStore();
  const t1 = buildToken({}, buildPayload({ jti: 'tok-A' }));
  const t2 = buildToken({}, buildPayload({ jti: 'tok-B' }));
  assert((await verifyEntitlementToken({ token: t1, verifier: v, now: 50000, seenJtis: seen })).ok, `A ok`);
  assert((await verifyEntitlementToken({ token: t2, verifier: v, now: 50000, seenJtis: seen })).ok, `B ok`);
  assert(seen.size() === 2, `2 seen`);
}

// 20. THE audit's headline: a forged "valid":true raw-JSON object → malformed-envelope
{
  const v = stubVerifier({ knownKids: ['kid-1'] });
  const forged = {
    code: 'WHATEVER', name: 'PRO User',
    validatedAt: 9999999999999, valid: true,
  };
  const r = await verifyEntitlementToken({ token: forged, verifier: v, now: 50000 });
  assert(!r.ok, `forged JSON rejected`);
  if (!r.ok) assert(r.reason === 'malformed-envelope', `forged → malformed-envelope`);
}

// 21. verifyFailureMessage: each reason has user copy
{
  const reasons: VerifyFailureReason[] = [
    'malformed-envelope', 'malformed-payload',
    'unsupported-alg', 'unknown-kid', 'bad-signature',
    'expired', 'not-yet-valid', 'clock-skew-exceeded',
    'replay-detected', 'device-mismatch',
  ];
  const messages = new Set<string>();
  for (const r of reasons) {
    const msg = verifyFailureMessage(r);
    assert(msg.length > 0, `'${r}': non-empty`);
    messages.add(msg);
  }
  assert(messages.size === reasons.length, `each message distinct`);
}

// 22. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/entitlements/SignedEntitlementToken.ts'), 'utf-8');
  assert(/T2-90/.test(src), 'T2-90 marker');
  for (const id of [
    'SigningAlg', 'SignedEntitlementToken', 'EntitlementTokenPayload',
    'VerifyFailureReason', 'VerifyResult',
    'base64UrlEncode', 'base64UrlDecode',
    'isWellFormedToken', 'isWellFormedPayload',
    'decodePayload', 'EntitlementVerifier', 'JtiSeenStore',
    'verifyEntitlementToken', 'InMemoryJtiStore',
    'verifyFailureMessage',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const r of ['malformed-envelope', 'malformed-payload',
                   'unsupported-alg', 'unknown-kid', 'bad-signature',
                   'expired', 'not-yet-valid', 'clock-skew-exceeded',
                   'replay-detected', 'device-mismatch']) {
    assert(src.includes(`'${r}'`), `reason '${r}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
