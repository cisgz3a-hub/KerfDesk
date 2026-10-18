// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  claims,
  grant,
  harness,
  NOW,
  saved,
  TEST_KEY,
  trialClaims,
} from './licensing-runtime.test-support';

it.each(['paid', 'trial'] as const)(
  'reads local %s status while a periodic refresh waits on the network',
  async (tier) => {
    const rights = tier === 'trial' ? trialClaims() : claims();
    const h = harness({
      ...saved(rights),
      refreshedAt: NOW / 1000 - (tier === 'trial' ? 2 : 8) * 86_400,
    });
    let reply!: (response: Response) => void;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }),
    );
    const background = h.runtime.refreshInBackground();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce());
    // A reopened renderer must not wait for the service timeout to admit cached rights.
    await expect(h.runtime.status()).resolves.toMatchObject({ edition: 'pro', tier });
    reply(grant(rights));
    await expect(background).resolves.toMatchObject({ edition: 'pro', tier });
  },
);

it('does not overwrite a newer explicit activation with a late background reply', async () => {
  const h = harness({ ...saved(), refreshedAt: NOW / 1000 - 8 * 86_400 });
  let reply!: (response: Response) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        reply = resolve;
      }),
  );
  const background = h.runtime.refreshInBackground();
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce());
  const replacement = claims({ activationId: 'activation-2' });
  h.fetch.mockResolvedValueOnce(grant(replacement));
  await expect(h.runtime.activate(TEST_KEY)).resolves.toMatchObject({ edition: 'pro' });
  const activated = h.saved();
  reply(grant());
  await background;
  expect(h.saved()?.credential).toEqual(activated?.credential);
});

it('coalesces background checks while allowing trial expiry to remain observable', async () => {
  const rights = trialClaims({ accessExpiresAt: NOW / 1000 + 1, updatesUntil: NOW / 1000 + 1 });
  const h = harness({ ...saved(rights), refreshedAt: NOW / 1000 - 8 * 86_400 });
  let reply!: (response: Response) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        reply = resolve;
      }),
  );
  const first = h.runtime.refreshInBackground();
  expect(h.runtime.refreshInBackground()).toBe(first);
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce());
  h.clock(NOW + 1001);
  await expect(h.runtime.status()).resolves.toMatchObject({
    edition: 'free',
    state: 'trial-expired',
  });
  reply(grant(rights));
  await expect(first).resolves.toMatchObject({ edition: 'free', state: 'trial-expired' });
});
