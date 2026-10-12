import { expect, it } from 'vitest';
import { grant, harness, saved, TEST_KEY } from './licensing-runtime.test-support';

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
