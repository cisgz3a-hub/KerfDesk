import { expect, it, vi } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import {
  claims,
  grant,
  harness,
  NOW,
  saved,
  TEST_KEY,
  trialClaims,
} from './licensing-runtime.test-support';

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

const DAY_MS = 86_400_000;
it.each([
  { side: 'ahead', offset: 3600, text: 'about 60 minutes ahead' },
  { side: 'behind', offset: -2 * 3600, text: 'about 2 hours behind' },
] as const)(
  'counts a paid refresh as a check-in when this clock is $side, timed from its arrival',
  async ({ offset, text }) => {
    // The service's time is `served`; this computer's clock is `offset` seconds off.
    const served = NOW + 8 * DAY_MS;
    const local = served + offset * 1000;
    const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
    h.clock(local);
    h.fetch.mockResolvedValue(grant(claims({ issuedAt: served / 1000 })));
    const refreshed = await h.runtime.refresh();
    expect(refreshed).toMatchObject({ state: 'ready', edition: 'pro', tier: 'paid' });
    expect(refreshed.message).toContain(text);
    expect(refreshed.message).toContain('Set time automatically');
    expect(h.saved()).toMatchObject({ clockOffset: offset, lastSeenAt: local / 1000 });
    // Thirty days after the grant arrived here, on this computer's clock.
    h.clock(local + 30 * DAY_MS);
    const later = await createLicensingRuntime(h.options).status();
    expect(later).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(later.message).toContain(text);
    h.clock(local + 30 * DAY_MS + 1000);
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      state: 'checkin-required',
      edition: 'free',
    });
    // A clock-correct refresh drops the offset and its warning.
    h.clock(served + 31 * DAY_MS);
    h.fetch.mockResolvedValue(grant(claims({ issuedAt: served / 1000 + 31 * 86_400 })));
    const corrected = await h.runtime.refresh();
    expect(corrected).toMatchObject({ state: 'ready', edition: 'pro', message: null });
    expect(h.saved()?.clockOffset).toBeUndefined();
  },
);
it('still refuses a trial, an activation or a paid offset beyond one check-in period', async () => {
  const trial = harness({ ...saved(trialClaims()), refreshedAt: NOW / 1000 });
  trial.fetch.mockResolvedValue(grant(trialClaims({ issuedAt: NOW / 1000 - 3600 })));
  expect(await trial.runtime.refresh()).toMatchObject({ state: 'clock-error', tier: 'trial' });
  expect(trial.saved()?.clockOffset).toBeUndefined();
  expect(trial.saved()?.credential).toEqual(saved(trialClaims()).credential);
  const activation = harness();
  activation.fetch.mockResolvedValue(grant(claims({ issuedAt: NOW / 1000 - 3600 })));
  expect(await activation.runtime.activate(TEST_KEY)).toMatchObject({ state: 'clock-error' });
  expect(activation.saved()).toBeNull();
  const far = harness({ ...saved(), refreshedAt: NOW / 1000 });
  far.fetch.mockResolvedValue(grant(claims({ issuedAt: NOW / 1000 - 31 * 86_400 })));
  const refused = await far.runtime.refresh();
  expect(refused).toMatchObject({ state: 'clock-error' });
  expect(refused.message).toContain('could not be confirmed');
  expect(far.saved()?.clockOffset).toBeUndefined();
  expect(far.saved()?.credential).toEqual(saved().credential);
});
it('bounds an edited paid clock offset to one check-in period', async () => {
  const h = harness({ ...saved(), clockOffset: 10 * 365 * 86_400 });
  h.clock(NOW + 60 * DAY_MS);
  expect(await h.runtime.status()).toMatchObject({ state: 'ready' });
  h.clock(NOW + 60 * DAY_MS + 1000);
  expect(await createLicensingRuntime(h.options).status()).toMatchObject({
    state: 'checkin-required',
  });
});
it('keeps a paid last-seen mark, so winding the clock back cannot postpone the check-in', async () => {
  const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
  h.fetch.mockRejectedValue(new Error('offline'));
  h.clock(NOW + 20 * DAY_MS);
  await h.runtime.status();
  expect(h.saved()?.lastSeenAt).toBe(NOW / 1000 + 20 * 86_400);
  // Wound back to just after the grant: Pro stays, but the service is asked at once.
  h.clock(NOW + 3_600_000);
  const wound = createLicensingRuntime(h.options);
  expect(await wound.status()).toMatchObject({ state: 'ready', edition: 'pro' });
  expect(await wound.refreshInBackground()).toMatchObject({ state: 'ready' });
  expect(h.fetch).toHaveBeenCalledOnce();
  // The mark keeps the time already seen, so the check-in still falls due.
  h.clock(NOW + 31 * DAY_MS);
  await createLicensingRuntime(h.options).status();
  h.clock(NOW + 3_600_000);
  expect(await createLicensingRuntime(h.options).status()).toMatchObject({
    state: 'checkin-required',
    edition: 'free',
  });
});
it('moves the paid mark on by session time even while the clock is held back', async () => {
  let elapsed = 0;
  const elapsedClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  try {
    const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
    await h.runtime.status();
    elapsed = 10 * DAY_MS;
    await h.runtime.status();
    expect(h.saved()?.lastSeenAt).toBe(NOW / 1000 + 10 * 86_400);
  } finally {
    elapsedClock.mockRestore();
  }
});
it('keeps a paid status when its last-seen mark cannot be saved', async () => {
  const h = harness(saved());
  h.store.write.mockRejectedValue(new Error('disk full'));
  h.clock(NOW + 3_600_000);
  expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
});
