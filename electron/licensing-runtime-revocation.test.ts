import { expect, it } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { grant, harness, NOW, saved, TEST_KEY } from './licensing-runtime.test-support';

// A paid licence works offline indefinitely (ADR-623 Amendment 2), so a refund
// reaches it only when the computer next reaches the licence service.
it('applies a refund at the first successful refresh after months offline', async () => {
  const h = harness({ ...saved(), licenseKey: TEST_KEY, refreshedAt: NOW / 1000 });
  h.fetch.mockRejectedValue(new Error('offline'));
  h.clock(NOW + 90 * 86_400_000);
  expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
  expect(await h.runtime.refreshInBackground()).toMatchObject({ edition: 'pro' });
  expect(h.saved()?.credential).toBeDefined();

  h.fetch.mockResolvedValue(Response.json({ error: { code: 'license_revoked' } }, { status: 403 }));
  expect(await h.runtime.refreshInBackground()).toMatchObject({
    state: 'activation-required',
    edition: 'free',
    licenseKey: null,
  });
  expect(h.runtime.proUnlocked()).toBe(false);
  expect(h.saved()?.credential).toBeUndefined();
  // The next launch opens behind the licence window (ADR-623).
  expect(await createLicensingRuntime(h.options).status()).toMatchObject({
    state: 'activation-required',
    edition: 'free',
  });
});

it.each(['license_revoked', 'activation_inactive'])(
  'locks new Pro choices after %s, including an already unlocked paid session',
  async (code) => {
    const h = harness({ ...saved(), licenseKey: TEST_KEY });
    expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(h.runtime.proUnlocked()).toBe(true);
    h.fetch.mockResolvedValue(Response.json({ error: { code } }, { status: 403 }));

    expect(await h.runtime.refresh()).toMatchObject({
      state: 'activation-required',
      edition: 'free',
      licenseKey: code === 'license_revoked' ? null : TEST_KEY,
    });
    expect(h.runtime.proUnlocked()).toBe(false);
    expect(await h.runtime.status()).toMatchObject({ edition: 'free' });
  },
);

it('does not revive a rejected grant when the disk write fails, and accepts a later online grant', async () => {
  const h = harness(saved());
  expect((await h.runtime.status()).edition).toBe('pro');
  h.fetch.mockResolvedValueOnce(
    Response.json({ error: { code: 'license_revoked' } }, { status: 403 }),
  );
  h.store.write.mockRejectedValueOnce(new Error('Disk write failed'));

  expect(await h.runtime.refresh()).toMatchObject({ state: 'unavailable', edition: 'free' });
  expect(h.saved()?.credential).toBeDefined();
  expect(h.runtime.proUnlocked()).toBe(false);
  expect(await h.runtime.status()).toMatchObject({ state: 'activation-required', edition: 'free' });

  h.fetch.mockResolvedValueOnce(grant());
  expect(await h.runtime.activate(TEST_KEY)).toMatchObject({ state: 'ready', edition: 'pro' });
});
