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

const DAY_MS = 86_400_000;

it('pauses new trial Pro choices after 3 days without confirmation (ADR-592)', async () => {
  const h = harness(saved(trialClaims()));
  h.fetch.mockRejectedValue(new Error('offline'));
  h.clock(NOW + 3 * DAY_MS);
  expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro' });
  const late = harness(saved(trialClaims()));
  late.fetch.mockRejectedValue(new Error('offline'));
  late.clock(NOW + 3 * DAY_MS + 1000);
  const paused = await late.runtime.status();
  expect(paused).toMatchObject({ state: 'checkin-required', edition: 'free', tier: 'trial' });
  expect(paused.message).toContain('Refresh licence');
  // Saved rights are kept, and a background check tries the service at once.
  expect(await late.runtime.refreshInBackground()).toMatchObject({
    state: 'checkin-required',
  });
  expect(late.fetch).toHaveBeenCalledOnce();
  expect(late.saved()?.credential).toEqual(saved(trialClaims()).credential);
});
it('restores trial Pro once an overdue trial confirms its rights online', async () => {
  const h = harness(saved(trialClaims()));
  const later = NOW + 4 * DAY_MS;
  h.clock(later);
  expect((await h.runtime.status()).state).toBe('checkin-required');
  h.fetch.mockResolvedValue(grant(trialClaims({ issuedAt: later / 1000 })));
  expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro' });
});

// The maintainer chose LightBurn's model for paid licences on 2026-10-20 (ADR-623 Amendment 2).
it.each([31, 400])(
  'opens a paid licence with Pro after %s days offline, and keeps trying quietly',
  async (days) => {
    const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
    h.fetch.mockRejectedValue(new Error('offline'));
    h.clock(NOW + days * DAY_MS);
    // A new runtime is a new launch: the licence window lets this licence in.
    const status = await h.runtime.status();
    expect(status).toMatchObject({ state: 'ready', edition: 'pro', tier: 'paid', message: null });
    expect(status.checkInDueAt).toBeUndefined();
    expect(h.runtime.proUnlocked()).toBe(true);
    // Each quiet check asks again, and a failure changes nothing the window or a Pro tool reads.
    expect(await h.runtime.refreshInBackground()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(await h.runtime.refreshInBackground()).toMatchObject({ state: 'ready', edition: 'pro' });
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(await h.runtime.status()).toMatchObject({
      state: 'ready',
      edition: 'pro',
      message: null,
    });
    expect(h.runtime.proUnlocked()).toBe(true);
    expect(h.saved()?.credential).toEqual(saved().credential);
  },
);
it('still binds an offline paid licence to this device', async () => {
  const h = harness(saved());
  h.clock(NOW + 400 * DAY_MS);
  const elsewhere = createLicensingRuntime({ ...h.options, deviceId: async () => 'x'.repeat(43) });
  expect(await elsewhere.status()).toMatchObject({ state: 'invalid-licence', edition: 'free' });
});
it.each([
  { side: 'ahead', days: 40 },
  { side: 'behind', days: -40 },
])(
  'opens a paid licence with Pro when the clock is 40 days $side, and accepts its refresh',
  async ({ days }) => {
    // The licence service's time is `served`; this computer's clock is `days` off.
    const served = NOW + 2 * DAY_MS;
    const local = served + days * DAY_MS;
    const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
    h.clock(local);
    h.fetch.mockResolvedValue(grant(claims({ issuedAt: served / 1000 })));
    expect(await h.runtime.status()).toMatchObject({
      state: 'ready',
      edition: 'pro',
      message: null,
    });
    // Ahead, a day has passed; behind, the clock is earlier than the last refresh: both ask.
    expect(await h.runtime.refreshInBackground()).toMatchObject({
      state: 'ready',
      edition: 'pro',
      tier: 'paid',
      message: null,
    });
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.saved()).toMatchObject({ refreshedAt: local / 1000 });
    expect(h.saved()?.clockOffset).toBeUndefined();
    expect(await createLicensingRuntime(h.options).status()).toMatchObject({
      state: 'ready',
      edition: 'pro',
      message: null,
    });
  },
);
// The desktop app ships for macOS and Linux too (ADR-623 Amendment 1).
it.each([
  { platform: 'darwin', setting: 'System Settings > General > Date & Time' },
  { platform: 'linux', setting: 'your desktop’s date and time settings' },
])(
  'names $platform’s own clock settings in every trial clock message',
  async ({ platform, setting }) => {
    const on = (h: ReturnType<typeof harness>) =>
      createLicensingRuntime({ ...h.options, platform });
    const overdue = harness(saved(trialClaims()));
    overdue.clock(NOW + 4 * DAY_MS);
    const rolledBack = harness(saved(trialClaims()));
    rolledBack.clock(NOW - 600_000);
    const refused = harness();
    refused.fetch.mockResolvedValue(grant(trialClaims({ issuedAt: NOW / 1000 + 2 * 3600 })));
    const messages = [
      await on(overdue).status(),
      await on(rolledBack).status(),
      await on(refused).startTrial(),
    ].map((status) => `${status.state}: ${status.message}`);
    expect(messages.map((message) => message.split(':')[0])).toEqual([
      'checkin-required',
      'clock-error',
      'clock-error',
    ]);
    for (const message of messages) {
      expect(message).toContain(setting);
      expect(message).not.toContain('Windows');
    }
  },
);
it('still refuses a trial or developer grant from a clock that is off, but never a paid one', async () => {
  const trial = harness({ ...saved(trialClaims()), refreshedAt: NOW / 1000 });
  trial.fetch.mockResolvedValue(grant(trialClaims({ issuedAt: NOW / 1000 - 3600 })));
  expect(await trial.runtime.refresh()).toMatchObject({ state: 'clock-error', tier: 'trial' });
  expect(trial.saved()?.credential).toEqual(saved(trialClaims()).credential);
  const developer = harness();
  developer.fetch.mockResolvedValue(
    grant(
      claims({
        tier: 'developer',
        perpetualUpdates: true,
        updatesUntil: null,
        issuedAt: NOW / 1000 - 3600,
      }),
    ),
  );
  expect(await developer.runtime.activate(TEST_KEY)).toMatchObject({ state: 'clock-error' });
  expect(developer.saved()).toBeNull();
  const paid = harness();
  paid.fetch.mockResolvedValue(grant(claims({ issuedAt: NOW / 1000 - 40 * 86_400 })));
  expect(await paid.runtime.activate(TEST_KEY)).toMatchObject({
    state: 'ready',
    edition: 'pro',
    tier: 'paid',
    message: null,
  });
  expect(paid.saved()?.licenseKey).toBe(TEST_KEY);
});
it('ignores a clock offset an older version saved, and drops it at the next grant', async () => {
  const h = harness({ ...saved(), refreshedAt: NOW / 1000, clockOffset: 20 * 86_400 });
  expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro', message: null });
  h.clock(NOW + 400 * DAY_MS);
  expect(await createLicensingRuntime(h.options).status()).toMatchObject({
    state: 'ready',
    edition: 'pro',
    message: null,
  });
  h.fetch.mockResolvedValue(grant(claims({ issuedAt: NOW / 1000 + 400 * 86_400 })));
  expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro' });
  expect(h.saved()?.clockOffset).toBeUndefined();
});
it('keeps a paid last-seen mark, so winding the clock back asks the service at once but never locks', async () => {
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
  // Seen 40 days on, then wound back again: the next launch still opens with Pro.
  h.clock(NOW + 40 * DAY_MS);
  await createLicensingRuntime(h.options).status();
  h.clock(NOW + 3_600_000);
  expect(await createLicensingRuntime(h.options).status()).toMatchObject({
    state: 'ready',
    edition: 'pro',
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
it('moves a clock mark on at each quiet check without calling the service', async () => {
  const trial = harness({ ...saved(trialClaims()), refreshedAt: NOW / 1000 });
  trial.clock(NOW + 30 * 60_000);
  expect(await trial.runtime.refreshInBackground()).toMatchObject({ state: 'ready' });
  expect(trial.fetch).not.toHaveBeenCalled();
  expect(trial.saved()?.lastSeenAt).toBe(NOW / 1000 + 1800);
  const paid = harness({ ...saved(), refreshedAt: NOW / 1000 });
  paid.clock(NOW + 30 * 60_000);
  await paid.runtime.refreshInBackground();
  expect(paid.fetch).not.toHaveBeenCalled();
  expect(paid.saved()?.lastSeenAt).toBe(NOW / 1000 + 1800);
});
