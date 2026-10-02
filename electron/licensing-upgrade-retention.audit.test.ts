// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LicensingConfig } from './licensing-config.js';
import { createLicensingRuntime } from './licensing-runtime.js';
import { createLicensingStore, type LicenceRecord } from './licensing-store.js';
import type { LicenceClaims, SignedEntitlement } from './licensing-verification.js';

const ISSUED = Date.parse('2026-10-03T01:00:00.000Z') / 1000;
const DAY = 86_400;
const device = createHash('sha256').update('upgrade audit computer').digest('base64url');
const otherDevice = createHash('sha256').update('different audit computer').digest('base64url');
const pair = generateKeyPairSync('ed25519');
const keys = { upgrade: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const token = Buffer.alloc(32, 19).toString('base64url');
const key = 'KD1.synthetic-upgrade-audit';
const directories: string[] = [];

afterEach(async () => {
  for (const path of directories.splice(0)) {
    if (dirname(path) !== tmpdir() || !basename(path).startsWith('kerfdesk-upgrade-audit-'))
      throw new Error('Refusing to remove an unowned profile.');
    await rm(path, { recursive: true, force: true });
  }
});

function signed(value: unknown, release = false) {
  const bytes = Buffer.from(JSON.stringify(value));
  const encoding = release ? 'base64' : 'base64url';
  return {
    ...(release ? { schemaVersion: 1, algorithm: 'Ed25519' } : {}),
    keyId: 'upgrade',
    payload: bytes.toString(encoding),
    signature: sign(null, bytes, pair.privateKey).toString(encoding),
  };
}

function rights(tier: 'paid' | 'trial'): LicenceClaims {
  const expires = tier === 'trial' ? ISSUED + 30 * DAY : null;
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    licenseId: 'upgrade-licence',
    activationId: 'upgrade-seat',
    deviceId: device,
    tier,
    issuedAt: ISSUED,
    accessExpiresAt: expires,
    updatesUntil: expires ?? ISSUED + 365 * DAY,
    perpetualUpdates: false,
    maxDevices: 3,
  };
}

function config(version: string, publishedAt = ISSUED - DAY): LicensingConfig {
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
const encode = (value: unknown): Buffer =>
  Buffer.from(Buffer.from(JSON.stringify(value)).map((byte) => byte ^ 0x5a));
async function harness(tier: 'paid' | 'trial') {
  const profile = await mkdtemp(join(tmpdir(), 'kerfdesk-upgrade-audit-'));
  directories.push(profile);
  const file = join(profile, 'commercial-licence.v1');
  const store = createLicensingStore({
    userDataPath: profile,
    platform: 'win32',
    secureStorage: {
      isAsyncEncryptionAvailable: async () => true,
      getSelectedStorageBackend: () => 'audit-mock-only',
      encryptStringAsync: async (value) => encode(JSON.parse(value)),
      decryptStringAsync: async (value) => ({
        result: value.map((byte) => byte ^ 0x5a).toString(),
        shouldReEncrypt: false,
      }),
    },
  });
  let now = ISSUED;
  const entitlement = signed(rights(tier));
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

describe('saved commercial rights through a fresh 1.0.8 runtime', () => {
  it.each(['paid', 'trial'] as const)(
    'retains the original %s grant through upgrade and two fresh sessions',
    async (tier) => {
      const h = await harness(tier);
      const original = await h.store.read();
      h.time(ISSUED + 10 * DAY);
      for (let restart = 0; restart < 2; restart++) {
        const runtime = h.runtime();
        expect(await runtime.status()).toMatchObject({ state: 'ready', edition: 'pro', tier });
        const restored = await h.store.read();
        expect(restored?.credential).toEqual(original?.credential);
        expect(restored?.licenseKey).toBe(tier === 'paid' ? key : undefined);
        expect(
          JSON.parse(
            Buffer.from(restored?.credential?.entitlement.payload ?? '', 'base64url').toString(),
          ),
        ).toMatchObject({ issuedAt: ISSUED, accessExpiresAt: rights(tier).accessExpiresAt });
      }
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['paid', 'trial'] as const)(
    'accepts a legacy schema-1 %s record without optional key or refresh fields',
    async (tier) => {
      const h = await harness(tier);
      const saved = await h.store.read();
      if (saved?.credential === undefined) throw new Error('Expected the old saved credential.');
      const legacy: LicenceRecord = {
        schemaVersion: 1,
        lastSeenAt: saved.lastSeenAt,
        credential: saved.credential,
      };
      await h.store.write(legacy);
      const before = await readFile(h.file);
      const runtime = h.runtime();
      expect(await runtime.status()).toMatchObject({
        state: 'ready',
        edition: 'pro',
        licenseKey: null,
      });
      expect(await readFile(h.file)).toEqual(before);
      expect(await runtime.refreshInBackground()).toMatchObject({ state: 'ready', edition: 'pro' });
      expect(await h.store.read()).toEqual(legacy);
      expect(h.fetch).toHaveBeenCalledOnce();
    },
  );

  it.each(['paid', 'trial'] as const)(
    'keeps saved %s rights and its key after a due offline startup refresh',
    async (tier) => {
      const h = await harness(tier);
      h.time(ISSUED + 8 * DAY);
      const saved = await h.store.read();
      expect(await h.runtime().refreshInBackground()).toMatchObject({
        state: 'ready',
        edition: 'pro',
        tier,
      });
      expect((await h.store.read())?.credential).toEqual(saved?.credential);
      expect((await h.store.read())?.licenseKey).toBe(tier === 'paid' ? key : undefined);
      expect(h.fetch).toHaveBeenCalledOnce();
    },
  );

  it('retains a paid key when a new release is uncovered and unlocks a covered downgrade', async () => {
    const h = await harness('paid');
    const before = await readFile(h.file);
    expect(await h.runtime('1.0.8', device, ISSUED + 366 * DAY).status()).toMatchObject({
      state: 'updates-expired',
      edition: 'free',
      licenseKey: key,
    });
    expect(await h.runtime('1.0.7').status()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(await readFile(h.file)).toEqual(before);
  });

  it.each([-1000 * DAY, 1000 * DAY])(
    'keeps a covered paid version at clock offset %s',
    async (offset) => {
      const h = await harness('paid');
      const before = await readFile(h.file);
      h.time(ISSUED + offset);
      expect(await h.runtime().status()).toMatchObject({
        state: 'ready',
        edition: 'pro',
        licenseKey: key,
      });
      expect(await readFile(h.file)).toEqual(before);
    },
  );
});

describe('an upgraded trial keeps its original expiry and clock boundaries', () => {
  it.each([1, 59, 299, 300])(
    'keeps an observed expiry across two restarts with %s seconds of clock correction',
    async (back) => {
      const h = await harness('trial');
      const expiry = ISSUED + 30 * DAY;
      h.time(expiry);
      expect(await h.runtime().status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
      const expiredFile = await readFile(h.file);
      h.time(expiry - back);
      for (let restart = 0; restart < 2; restart++) {
        expect(await h.runtime().status()).toMatchObject({
          state: 'trial-expired',
          edition: 'free',
        });
        expect(await readFile(h.file)).toEqual(expiredFile);
      }
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it('carries observed elapsed progress through short fresh sessions with a corrected wall clock', async () => {
    const h = await harness('trial');
    const expiry = ISSUED + 30 * DAY;
    let elapsed = 0;
    const elapsedClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    try {
      h.time(expiry - 90);
      expect((await h.runtime().status()).edition).toBe('pro');
      h.time(expiry - 150);
      for (let session = 1; session <= 3; session++) {
        const runtime = h.runtime();
        expect(await runtime.status()).toMatchObject({
          edition: 'pro',
          trialExpiresInMs: (90 - (session - 1) * 31) * 1000,
          accessExpiresAt: expiry,
        });
        elapsed += 31_000;
        expect(await runtime.status()).toMatchObject({
          state: session < 3 ? 'ready' : 'trial-expired',
          edition: session < 3 ? 'pro' : 'free',
          trialExpiresInMs: Math.max(0, 90 - session * 31) * 1000,
        });
        expect((await h.store.read())?.lastSeenAt).toBe(expiry - 90 + session * 31);
      }
      expect(await h.runtime().status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
      expect(h.fetch).not.toHaveBeenCalled();
    } finally {
      elapsedClock.mockRestore();
    }
  });

  it('persists the final second at expiry before the next fresh session', async () => {
    const h = await harness('trial');
    const expiry = ISSUED + 30 * DAY;
    let elapsed = 0;
    const elapsedClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    try {
      h.time(expiry - 1);
      expect((await h.runtime().status()).edition).toBe('pro');
      h.time(expiry - 61);
      const runtime = h.runtime();
      expect((await runtime.status()).edition).toBe('pro');
      elapsed = 1000;
      expect(runtime.proUnlocked()).toBe(false);
      expect(await runtime.status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
      expect((await h.store.read())?.lastSeenAt).toBe(expiry);
      expect(await h.runtime().status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
    } finally {
      elapsedClock.mockRestore();
    }
  });

  it('accepts a later signed Free update after recorded expiry despite a small clock correction', async () => {
    const h = await harness('trial');
    const expiry = ISSUED + 30 * DAY;
    h.time(expiry);
    expect((await h.runtime().status()).state).toBe('trial-expired');
    h.time(expiry - 60);
    const update = signed(
      {
        schemaVersion: 1,
        product: 'kerfdesk-desktop',
        kind: 'update-manifest',
        channel: 'stable',
        version: '1.0.9',
        sourceSha: 'c998b4d82971fdacfbb1e2d36cc93c2d30080245',
        sourceRef: 'synthetic-upgrade-audit',
        publishedAt: new Date((expiry + DAY) * 1000).toISOString(),
      },
      true,
    );
    expect(await h.runtime().isReleaseEligible(update, '1.0.9')).toBe(true);
  });

  it('persists observed progress when a due quiet refresh is offline', async () => {
    const h = await harness('trial');
    const observed = ISSUED + 8 * DAY;
    h.time(observed);
    expect(await h.runtime().refreshInBackground()).toMatchObject({
      state: 'ready',
      edition: 'pro',
    });
    expect((await h.store.read())?.lastSeenAt).toBe(observed);
    expect(h.fetch).toHaveBeenCalledOnce();
  });

  it.each(['refresh', 'refreshInBackground', 'activate', 'startTrial'] as const)(
    'persists expiry observed during an offline %s request',
    async (action) => {
      const h = await harness('trial');
      const expiry = ISSUED + 30 * DAY;
      h.time(expiry - 1);
      h.fetch.mockImplementation(async () => {
        h.time(expiry);
        throw new Error('Synthetic offline boundary; no HTTP is performed.');
      });
      const runtime = h.runtime();
      const result = action === 'activate' ? await runtime.activate(key) : await runtime[action]();
      expect(result).toMatchObject({ state: 'trial-expired', edition: 'free' });
      expect((await h.store.read())?.lastSeenAt).toBe(expiry);
      h.time(expiry - 30);
      expect(await h.runtime().status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
    },
  );

  it('persists cached expiry even when a fresh grant fails its time check', async () => {
    const h = await harness('trial');
    const expiry = ISSUED + 30 * DAY;
    h.time(expiry - 1);
    h.fetch.mockImplementation(async () => {
      h.time(expiry);
      return Response.json({
        entitlement: signed({ ...rights('trial'), issuedAt: expiry - 1000 }),
        activationToken: token,
      });
    });
    expect(await h.runtime().refresh()).toMatchObject({ state: 'clock-error', edition: 'free' });
    expect((await h.store.read())?.lastSeenAt).toBe(expiry);
    h.time(expiry - 30);
    expect(await h.runtime().status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
  });

  it.each([
    { code: 'internal_error', status: 500 },
    { code: 'rate_limited', status: 429 },
  ])('persists expiry after a non-definitive service response $code', async ({ code, status }) => {
    const h = await harness('trial');
    const expiry = ISSUED + 30 * DAY;
    const original = (await h.store.read())?.credential;
    h.time(expiry - 1);
    h.fetch.mockImplementation(async () => {
      h.time(expiry);
      return Response.json({ error: { code } }, { status });
    });
    expect(await h.runtime().refresh()).toMatchObject({ state: 'trial-expired', edition: 'free' });
    expect((await h.store.read())?.lastSeenAt).toBe(expiry);
    expect((await h.store.read())?.credential).toEqual(original);
    h.time(expiry - 30);
    expect(await h.runtime().status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
  });

  it.each([-1, 0, 1])('evaluates an original deadline at offset %s seconds', async (offset) => {
    const h = await harness('trial');
    h.time(ISSUED + 30 * DAY + offset);
    expect(await h.runtime().status()).toMatchObject({
      state: offset < 0 ? 'ready' : 'trial-expired',
      edition: offset < 0 ? 'pro' : 'free',
    });
    expect((await h.store.read())?.credential).toEqual({
      entitlement: h.entitlement,
      activationToken: token,
    });
  });

  it.each(['checkout', 'claimPayment', 'discardPayment', 'resetStore'] as const)(
    'persists observed expiry returned by %s without erasing saved rights',
    async (action) => {
      const h = await harness('trial');
      const expiry = ISSUED + 30 * DAY;
      h.time(expiry - 1);
      const runtime = h.runtime();
      expect((await runtime.status()).edition).toBe('pro');
      const original = (await h.store.read())?.credential;
      h.time(expiry);
      const result =
        action === 'checkout' ? await runtime.checkout('purchase') : await runtime[action]();
      expect(result).toMatchObject({ state: 'trial-expired', edition: 'free' });
      expect((await h.store.read())?.lastSeenAt).toBe(expiry);
      expect((await h.store.read())?.credential).toEqual(original);
      h.time(expiry - 30);
      expect(await h.runtime().status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
    },
  );

  it.each([300, 301])(
    'honours the documented rollback tolerance at %s seconds across restart',
    async (back) => {
      const h = await harness('trial');
      h.time(ISSUED + 10 * DAY);
      await h.runtime('1.0.7').status();
      h.time(ISSUED + 10 * DAY - back);
      expect(await h.runtime().status()).toMatchObject({
        state: back === 300 ? 'ready' : 'clock-error',
        edition: back === 300 ? 'pro' : 'free',
      });
      expect((await h.store.read())?.lastSeenAt).toBe(ISSUED + 10 * DAY);
    },
  );

  it('does not revive an expired open session when its wall clock is moved back', async () => {
    const h = await harness('trial');
    const runtime = h.runtime();
    expect((await runtime.status()).edition).toBe('pro');
    h.time(ISSUED + 30 * DAY);
    expect(await runtime.status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
    h.time(ISSUED + 15 * DAY);
    expect(await runtime.status()).toMatchObject({ state: 'trial-expired', edition: 'free' });
    expect(await h.runtime().status()).toMatchObject({ state: 'clock-error', edition: 'free' });
  });
});

type Tamper = { name: string; change: (envelope: SignedEntitlement) => SignedEntitlement };
function payloadChange(
  envelope: SignedEntitlement,
  patch: Record<string, unknown>,
): SignedEntitlement {
  const claims = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString());
  return {
    ...envelope,
    payload: Buffer.from(JSON.stringify({ ...claims, ...patch })).toString('base64url'),
  };
}
const TAMPERS: Tamper[] = [
  {
    name: 'extended signed expiry',
    change: (e) => payloadChange(e, { accessExpiresAt: ISSUED + 365 * DAY }),
  },
  {
    name: 'changed signed tier',
    change: (e) => payloadChange(e, { tier: 'paid', accessExpiresAt: null }),
  },
  {
    name: 'changed signed product',
    change: (e) => payloadChange(e, { product: 'another-product' }),
  },
  { name: 'changed signed device', change: (e) => payloadChange(e, { deviceId: otherDevice }) },
  { name: 'unknown signing key', change: (e) => ({ ...e, keyId: 'unknown-key' }) },
  { name: 'noncanonical payload', change: (e) => ({ ...e, payload: `${e.payload}=` }) },
  {
    name: 'altered signature',
    change: (e) => ({
      ...e,
      signature: `${e.signature[0] === 'A' ? 'B' : 'A'}${e.signature.slice(1)}`,
    }),
  },
];

describe('fresh upgrade rejects altered saved authority without erasing the record', () => {
  it.each(TAMPERS)('rejects $name in a previously saved trial', async ({ change }) => {
    const h = await harness('trial');
    const saved = await h.store.read();
    if (saved?.credential === undefined) throw new Error('Expected the old saved credential.');
    await h.store.write({
      ...saved,
      credential: { ...saved.credential, entitlement: change(saved.credential.entitlement) },
    });
    const tampered = await readFile(h.file);
    expect(await h.runtime().status()).toMatchObject({ state: 'invalid-licence', edition: 'free' });
    expect(await readFile(h.file)).toEqual(tampered);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(['paid', 'trial'] as const)(
    'rejects copied %s rights on a different installation',
    async (tier) => {
      const h = await harness(tier);
      const before = await readFile(h.file);
      expect(await h.runtime('1.0.8', otherDevice).status()).toMatchObject({
        state: 'invalid-licence',
        edition: 'free',
      });
      expect(await readFile(h.file)).toEqual(before);
    },
  );

  it.each([0, 2, null])(
    'preserves unsupported record schema %s for explicit recovery',
    async (schemaVersion) => {
      const h = await harness('paid');
      await writeFile(h.file, encode({ ...(await h.store.read()), schemaVersion }));
      const before = await readFile(h.file);
      expect(await h.runtime().status()).toMatchObject({
        state: 'invalid-licence',
        edition: 'free',
        storeUnreadable: true,
      });
      expect(await readFile(h.file)).toEqual(before);
    },
  );
});
