// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { prepareSandboxMetadata } from '../scripts/prepare-sandbox-desktop.mjs';
import { SANDBOX_ORIGIN } from '../public/desktop-sandbox-contract.mjs';
import { licensingConfigFromMetadata } from './licensing-config.js';
import { verifyLicenceRelease } from './licensing-verification.js';
import {
  isLicenceCheckoutUrl,
  prepareLicenceCheckout,
  validLicencePayment,
} from './licensing-commerce.js';
import { createLicensingStore } from './licensing-store.js';

const metadata = () =>
  prepareSandboxMetadata({
    sandboxOnly: true,
    version: '0.0.1',
    sourceSha: 'a'.repeat(40),
    publishedAt: '2026-09-30T01:00:00.000Z',
  });
const transaction = `txn_${'a'.repeat(26)}`;
const sandboxUrl = `${SANDBOX_ORIGIN}/buy.html?_ptxn=${transaction}`;
const productionUrl = `https://kerfdesk.com/buy.html?_ptxn=${transaction}`;
const order = {
  orderId: 'order-1',
  claimToken: 'c'.repeat(43),
  checkoutUrl: sandboxUrl,
  amount: 4950,
  currency: 'USD',
};

describe('isolated sandbox licensing', () => {
  it('accepts only the complete sandbox contract and verifies its release using the real runtime', () => {
    const value = metadata();
    const config = licensingConfigFromMetadata(value);
    expect(config.channel).toBe('commercial');
    if (config.channel !== 'commercial') throw new Error('sandbox config rejected');
    expect(config.sandbox).toBe(true);
    expect(verifyLicenceRelease(config.release, config.releaseKeys)).toEqual({
      version: '0.0.1',
      publishedAt: Date.parse('2026-09-30T01:00:00.000Z') / 1000,
    });
    for (const broken of [
      { ...value, name: 'laserforge' },
      { ...value, kerfdeskUpdateChannelTrusted: true },
      { ...value, kerfdeskSandbox: false },
      {
        ...value,
        kerfdeskCommercialLicense: {
          ...value.kerfdeskCommercialLicense,
          apiOrigin: 'https://license.kerfdesk.com',
        },
      },
    ])
      expect(licensingConfigFromMetadata(broken)).toEqual({ channel: 'invalid', sandbox: true });
  });

  it('never accepts a sandbox checkout in production, or a production checkout in sandbox', () => {
    expect(isLicenceCheckoutUrl(productionUrl)).toBe(true);
    expect(isLicenceCheckoutUrl(sandboxUrl)).toBe(false);
    expect(isLicenceCheckoutUrl(sandboxUrl, true)).toBe(true);
    expect(isLicenceCheckoutUrl(productionUrl, true)).toBe(false);
    for (const suffix of ['#fragment', '&extra=1', '@evil.example', '/'])
      expect(isLicenceCheckoutUrl(sandboxUrl + suffix, true)).toBe(false);
    const payment = { requestId: 'r'.repeat(43), operation: 'purchase', order };
    expect(validLicencePayment(payment)).toBe(false);
    expect(validLicencePayment(payment, true)).toBe(true);
  });

  it('persists and reopens a sandbox checkout only through its explicitly scoped store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-sandbox-store-'));
    const secureStorage = {
      isAsyncEncryptionAvailable: async () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptStringAsync: async (value: string) => Buffer.from(value),
      decryptStringAsync: async (value: Buffer) => ({
        result: value.toString(),
        shouldReEncrypt: false,
      }),
    };
    const store = createLicensingStore({
      userDataPath: directory,
      secureStorage,
      platform: 'win32',
      sandbox: true,
    });
    const request = vi.fn(async () => order);
    const openCheckout = vi.fn(async () => undefined);
    try {
      await prepareLicenceCheckout(
        { saved: { schemaVersion: 1, lastSeenAt: 0 }, store, request, openCheckout, sandbox: true },
        'purchase',
      );
      expect(openCheckout).toHaveBeenCalledWith(sandboxUrl);
      const saved = await store.read();
      expect(saved?.payment?.order?.checkoutUrl).toBe(sandboxUrl);
      const production = createLicensingStore({
        userDataPath: directory,
        secureStorage,
        platform: 'win32',
      });
      await expect(production.read()).rejects.toThrow('saved licence could not be read');
      if (saved === null) throw new Error('missing saved checkout');
      await expect(
        prepareLicenceCheckout({ saved, store, request, openCheckout }, 'purchase'),
      ).rejects.toThrow('destination');
      expect(openCheckout).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
