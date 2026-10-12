import { expect, it } from 'vitest';
import { claims, grant, harness, NOW, saved, trialClaims } from './licensing-runtime.test-support';

it.each([
  { tier: 'paid', limitDays: 30 },
  { tier: 'trial', limitDays: 3 },
] as const)(
  'pauses new $tier Pro choices after $limitDays days without confirmation (ADR-592)',
  async ({ tier, limitDays }) => {
    const rights = tier === 'trial' ? trialClaims() : claims();
    const h = harness(saved(rights));
    h.fetch.mockRejectedValue(new Error('offline'));
    h.clock(NOW + limitDays * 86_400_000);
    expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
    const late = harness(saved(rights));
    late.fetch.mockRejectedValue(new Error('offline'));
    late.clock(NOW + limitDays * 86_400_000 + 1000);
    const paused = await late.runtime.status();
    expect(paused).toMatchObject({ state: 'checkin-required', edition: 'free', tier });
    expect(paused.message).toContain('Refresh licence');
    // Saved rights are kept, and a background check tries the service at once.
    expect(await late.runtime.refreshInBackground()).toMatchObject({
      state: 'checkin-required',
    });
    expect(late.fetch).toHaveBeenCalledOnce();
    expect(late.saved()?.credential).toEqual(saved(rights).credential);
  },
);
it('restores Pro once an overdue device confirms its rights online', async () => {
  const h = harness(saved());
  const later = NOW + 31 * 86_400_000;
  h.clock(later);
  expect((await h.runtime.status()).state).toBe('checkin-required');
  h.fetch.mockResolvedValue(grant(claims({ issuedAt: later / 1000 })));
  expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro' });
});
it('pauses paid Pro when the clock is earlier than the last confirmation, but not developer rights', async () => {
  const paid = harness(saved());
  paid.clock(NOW - 600_000);
  expect(await paid.runtime.status()).toMatchObject({
    state: 'checkin-required',
    edition: 'free',
  });
  const developer = harness(
    saved(claims({ tier: 'developer', perpetualUpdates: true, updatesUntil: null })),
  );
  developer.clock(NOW - 600_000);
  expect(await developer.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
});
