import { expect, it } from 'vitest';
import {
  claims,
  device,
  envelope,
  harness,
  NOW,
  saved,
  token,
  trialClaims,
} from './licensing-runtime.test-support';

// ADR-592 Amendment 3: the refresh nonce of Amendment 1 is withdrawn. A refresh
// sends only the seat's credentials again, and a grant that 1.0.21 or 1.0.22
// had the service sign with a `refreshNonce` claim still verifies, whether it
// was saved on disk or arrives from a service that keeps signing nonces back.

const SIGNED_NONCE = 'n'.repeat(43);

it('sends only the activation credentials with a refresh', async () => {
  const h = harness(saved());
  await h.runtime.refresh();
  expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body))).toEqual({
    licenseId: 'license-1',
    activationId: 'activation-1',
    deviceId: device,
    activationToken: token,
  });
});

it('keeps a paid licence that 1.0.22 saved with a signed nonce, offline and on refresh', async () => {
  const older = { ...claims(), refreshNonce: SIGNED_NONCE };
  const h = harness(saved(older));
  h.fetch.mockRejectedValue(new Error('offline'));
  expect(await h.runtime.status()).toMatchObject({ state: 'ready', edition: 'pro', tier: 'paid' });
  const answer = { ...claims({ issuedAt: NOW / 1000 + 60 }), refreshNonce: 'm'.repeat(43) };
  h.fetch.mockResolvedValue(
    Response.json({ entitlement: envelope(answer), activationToken: token }),
  );
  expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', edition: 'pro', tier: 'paid' });
  expect(h.saved()?.credential?.entitlement).toEqual(envelope(answer));
});

it('accepts a trial refresh whose grant signs a nonce this app never sent', async () => {
  const h = harness({ ...saved(trialClaims()), refreshedAt: NOW / 1000 });
  const answer = { ...trialClaims(), refreshNonce: SIGNED_NONCE };
  h.fetch.mockResolvedValue(
    Response.json({ entitlement: envelope(answer), activationToken: token }),
  );
  expect(await h.runtime.refresh()).toMatchObject({ state: 'ready', tier: 'trial' });
  expect(h.saved()?.credential?.entitlement).toEqual(envelope(answer));
});
