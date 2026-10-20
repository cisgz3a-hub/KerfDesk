import { expect, it } from 'vitest';
import { createLicensingRuntime } from './licensing-runtime';
import { verifyEntitlement } from './licensing-verification';
import {
  answering,
  claims,
  device,
  envelope,
  harness,
  keys,
  NOW,
  saved,
  sentNonce,
  TEST_KEY,
  token,
  trialClaims,
} from './licensing-runtime.test-support';

// ADR-592 Amendment 1: a refresh grant counts only when it signs back the nonce
// its request sent, so a saved answer replayed through a proxy cannot push a
// trial's check-in on, or stand in for the refresh that would deliver a refund.
// Paid licences have no check-in or clock offset since ADR-623 Amendment 2.

const DAY = 86_400;
const DAY_MS = DAY * 1000;
const NONCE = /^[A-Za-z0-9_-]{43}$/;

it('sends a new random nonce with every refresh, and none with an activation or a trial', async () => {
  const h = harness(saved());
  h.fetch.mockImplementation(answering());
  await h.runtime.refresh();
  await h.runtime.refresh();
  const [first, second] = h.fetch.mock.calls.map(([, init]) => sentNonce(init));
  expect(first).toMatch(NONCE);
  expect(second).toMatch(NONCE);
  expect(second).not.toBe(first);
  expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body))).toEqual({
    licenseId: 'license-1',
    activationId: 'activation-1',
    deviceId: device,
    activationToken: token,
    refreshNonce: first,
  });
  const fresh = harness();
  await fresh.runtime.activate(TEST_KEY);
  await harness().runtime.startTrial();
  expect(sentNonce(fresh.fetch.mock.calls[0]![1])).toBeUndefined();
});

it('refuses a saved trial refresh answer replayed later, so its check-in still falls due', async () => {
  // A real refresh on day 2, which the trial user saves.
  const confirmed = NOW + 2 * DAY_MS;
  const h = harness({ ...saved(trialClaims()), refreshedAt: NOW / 1000 });
  h.clock(confirmed);
  const rights = trialClaims({ issuedAt: confirmed / 1000 });
  let kept: unknown;
  h.fetch.mockImplementationOnce(async (url, init) => {
    const response = await answering(rights)(url, init);
    kept = await response.clone().json();
    return response;
  });
  expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro' });
  const before = h.saved();
  // A proxy answers every later refresh with it.
  h.fetch.mockImplementation(async () => Response.json(kept));
  h.clock(confirmed + DAY_MS);
  expect(await h.runtime.refresh()).toMatchObject({ state: 'unavailable' });
  expect({ ...h.saved(), lastSeenAt: 0 }).toEqual({ ...before, lastSeenAt: 0 });
  // The trial check-in still falls due 3 days after the real confirmation.
  h.clock(confirmed + 3 * DAY_MS + 1000);
  expect(await createLicensingRuntime(h.options).status()).toMatchObject({
    state: 'checkin-required',
    edition: 'free',
  });
});

it('refuses a saved paid refresh answer replayed later, so it confirms nothing', async () => {
  const confirmed = NOW + 8 * DAY_MS;
  const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
  h.clock(confirmed);
  let kept: unknown;
  h.fetch.mockImplementationOnce(async (url, init) => {
    const response = await answering(claims({ issuedAt: confirmed / 1000 }))(url, init);
    kept = await response.clone().json();
    return response;
  });
  expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro' });
  const before = h.saved();
  h.fetch.mockImplementation(async () => Response.json(kept));
  h.clock(confirmed + 20 * DAY_MS);
  expect(await h.runtime.refresh()).toMatchObject({ state: 'unavailable' });
  // Not a confirmation: the next quiet check still asks the service, which is how a
  // refund reaches this computer. The licence itself keeps working (ADR-623 Amendment 2).
  expect({ ...h.saved(), lastSeenAt: 0 }).toEqual({ ...before, lastSeenAt: 0 });
  expect(await createLicensingRuntime(h.options).status()).toMatchObject({
    state: 'ready',
    edition: 'pro',
  });
});

it('refuses a grant that signs another request’s nonce, even on a correct clock', async () => {
  const h = harness(saved());
  h.fetch.mockResolvedValue(
    Response.json({
      entitlement: envelope(claims({ refreshNonce: 'n'.repeat(43) })),
      activationToken: token,
    }),
  );
  expect(await h.runtime.refresh()).toMatchObject({ state: 'unavailable' });
  expect(h.saved()).toEqual(saved());
});

it('refuses a replayed grant whose nonce was rewritten, because the signature covers it', async () => {
  const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
  h.clock(NOW + 20 * DAY_MS);
  h.fetch.mockImplementation(async (_url, init) => {
    const old = claims({ issuedAt: NOW / 1000, refreshNonce: 'o'.repeat(43) });
    const signed = envelope(old);
    const rewritten = { ...old, refreshNonce: sentNonce(init) };
    const payload = Buffer.from(JSON.stringify(rewritten)).toString('base64url');
    return Response.json({ entitlement: { ...signed, payload }, activationToken: token });
  });
  expect(await h.runtime.refresh()).toMatchObject({ state: 'unavailable' });
  expect(h.saved()?.clockOffset).toBeUndefined();
  expect(h.saved()?.credential).toEqual(saved().credential);
});

it('accepts a background paid refresh on a clock two hours ahead, and saves no offset', async () => {
  // Paid rights ignore the clock (ADR-623 Amendment 2); the refresh still brings its own nonce.
  const served = NOW + 31 * DAY_MS;
  const local = served + 2 * 3_600_000;
  const h = harness({ ...saved(), refreshedAt: NOW / 1000 });
  h.clock(local);
  h.fetch.mockImplementation(answering(claims({ issuedAt: served / 1000 })));
  expect(await h.runtime.refreshInBackground()).toMatchObject({ state: 'ready', edition: 'pro' });
  expect(h.fetch).toHaveBeenCalledOnce();
  expect(h.saved()).toMatchObject({ refreshedAt: local / 1000 });
  expect(h.saved()?.clockOffset).toBeUndefined();
});

it('accepts a nonce-free grant on a correct clock, as older services send', async () => {
  const h = harness(saved());
  h.clock(NOW + 8 * DAY_MS);
  h.fetch.mockImplementation(async () =>
    Response.json({
      entitlement: envelope(claims({ issuedAt: NOW / 1000 + 8 * DAY })),
      activationToken: token,
    }),
  );
  expect(await h.runtime.refresh()).toMatchObject({
    state: 'ready',
    edition: 'pro',
    message: null,
  });
  expect(h.saved()).toMatchObject({ refreshedAt: NOW / 1000 + 8 * DAY });
});

it('rejects a signed grant whose nonce is not 32 random bytes', () => {
  for (const refreshNonce of ['short', 7, null, `${'a'.repeat(42)}=`])
    expect(verifyEntitlement(envelope({ ...claims(), refreshNonce }), keys, device)).toBeNull();
  expect(
    verifyEntitlement(envelope(claims({ refreshNonce: 'a'.repeat(43) })), keys, device),
  ).toMatchObject({ refreshNonce: 'a'.repeat(43) });
});
