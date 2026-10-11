import test from 'node:test';
import assert from 'node:assert/strict';
import { start, connectDesktop, pairPhone, ORIGIN } from './support.mjs';

test('real workerd: expired idle phones lose push delivery and their stored subscription', async () => {
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const privateKey = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', vapid.publicKey)).toString(
    'base64url',
  );
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/local-test-only',
    keys: {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString('base64url'),
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
    },
  };
  const requests = [];
  const worker = start({
    clock: true,
    extra: {
      bindings: {
        PUBLIC_ORIGIN: ORIGIN,
        VAPID_PUBLIC_KEY: publicKey,
        VAPID_PRIVATE_KEY: privateKey.d,
        VAPID_SUBJECT: 'mailto:test@example.com',
      },
      outboundService: async (request) => {
        requests.push(request.url);
        return new Response(null, { status: 201 });
      },
    },
  });
  let desktop;
  const wait = () => new Promise((resolve) => setTimeout(resolve, 300));
  const advance = (offset) =>
    worker.dispatchFetch(`${ORIGIN}/__audit_clock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: desktop.deviceId, offset }),
    });
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    assert.equal((await phone.post('/api/client/push', { subscription })).status, 200);
    desktop.send({ type: 'event', kind: 'job.finished' });
    for (let attempt = 0; attempt < 20 && requests.length === 0; attempt++) await wait();
    assert.equal(requests.length, 1, 'unexpired approved phone receives an intercepted push');

    // No session request: exercise lazy expiry from desktop event delivery alone.
    await advance(9 * 3600000);
    desktop.send({ type: 'event', kind: 'job.stopped' });
    await wait();
    assert.equal(requests.length, 1, 'expired phone receives no push');

    // The old subscription must be deleted, not merely suppressed while time is expired.
    await advance(0);
    desktop.send({ type: 'event', kind: 'machine.alarm' });
    await wait();
    assert.equal(requests.length, 1, 'expired subscription was removed');
    assert.equal((await phone.post('/api/client/push', { subscription })).status, 200);
  } finally {
    desktop?.socket.close();
    await worker.dispose();
  }
});
