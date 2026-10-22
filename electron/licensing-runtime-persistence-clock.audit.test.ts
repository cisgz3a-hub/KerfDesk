// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { createLicensingStore, type LicensingStore } from './licensing-store';
import { grant, harness, saved, TEST_KEY, trialClaims } from './licensing-runtime.test-support';

const BEFORE_EPOCH = Date.parse('1969-12-31T00:00:00.000Z');

/** Real record validation and disk persistence, without native credential storage. */
async function withDiskStore(run: (store: LicensingStore) => Promise<void>): Promise<void> {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'kerfdesk-test-licence-clock-'));
  const store = createLicensingStore({
    userDataPath: directory,
    platform: 'win32',
    secureStorage: {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value) => Buffer.from(value),
      decryptStringAsync: async (value) => ({
        result: value.toString(),
        shouldReEncrypt: false,
      }),
    },
  });
  try {
    await run(store);
  } finally {
    const child = relative(temporaryRoot, directory);
    if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
      throw new Error('Unexpected temporary licence-store path');
    await rm(directory, { recursive: true, force: true });
  }
}

it.each([Date.parse('1990-01-01T00:00:00.000Z'), 0, BEFORE_EPOCH])(
  'persists paid activation on a wrong local clock (%s ms) and reopens offline',
  async (localClock) =>
    withDiskStore(async (store) => {
      const h = harness();
      h.clock(localClock);
      h.fetch.mockImplementation(async () => grant());
      const options = { ...h.options, store };
      expect(await createLicensingRuntime(options).activate(TEST_KEY)).toMatchObject({
        state: 'ready',
        edition: 'pro',
        tier: 'paid',
      });
      expect(await store.read()).toMatchObject({
        lastSeenAt: Math.max(0, localClock / 1000),
        refreshedAt: Math.max(0, localClock / 1000),
      });
      h.fetch.mockClear().mockRejectedValue(new Error('offline after restart'));
      expect(await createLicensingRuntime(options).status()).toMatchObject({
        state: 'ready',
        edition: 'pro',
      });
      expect(h.fetch).not.toHaveBeenCalled();
    }),
);

it('persists a refund despite a paid device clock before the epoch', async () =>
  withDiskStore(async (store) => {
    const h = harness();
    await store.write(saved());
    h.clock(BEFORE_EPOCH);
    h.fetch.mockResolvedValue(
      Response.json({ error: { code: 'license_revoked' } }, { status: 403 }),
    );
    const options = { ...h.options, store };
    const runtime = createLicensingRuntime(options);
    expect(await runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(await runtime.refreshInBackground()).toMatchObject({
      state: 'activation-required',
      edition: 'free',
    });
    expect(runtime.proUnlocked()).toBe(false);
    expect((await store.read())?.credential).toBeUndefined();
    expect((await store.read())?.refreshedAt).toBe(0);
    expect(await createLicensingRuntime(options).status()).toMatchObject({
      state: 'activation-required',
      edition: 'free',
    });
  }));

it('still refuses a new trial and a rolled-back saved trial on the same clock', async () =>
  withDiskStore(async (store) => {
    const h = harness();
    h.clock(BEFORE_EPOCH);
    h.fetch.mockResolvedValue(grant(trialClaims()));
    const options = { ...h.options, store };
    const fresh = createLicensingRuntime(options);
    expect(await fresh.startTrial()).toMatchObject({ state: 'clock-error', edition: 'free' });
    expect(fresh.proUnlocked()).toBe(false);
    expect(await store.read()).toBeNull();
    await store.write(saved(trialClaims()));
    const rolledBack = createLicensingRuntime(options);
    expect(await rolledBack.status()).toMatchObject({
      state: 'clock-error',
      edition: 'free',
      tier: 'trial',
    });
    expect(rolledBack.proUnlocked()).toBe(false);
  }));
