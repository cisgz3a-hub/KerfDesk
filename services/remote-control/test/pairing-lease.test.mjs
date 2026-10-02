import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, start, poster, connectDesktop, offer, cookieValue } from './support.mjs';

const closeSocket = (socket) => {
  if (socket && socket.readyState < 2) socket.close();
};
function duration(message, originalExpiry, offset) {
  assert.equal(message.expiresAt, originalExpiry);
  assert.equal(Number.isSafeInteger(message.expiresInMs), true);
  assert.ok(message.expiresInMs > 0 && message.expiresInMs <= 300_000);
  const remaining = originalExpiry - Date.now() - offset;
  assert.ok(Math.abs(message.expiresInMs - remaining) < 2000);
}

test('real workerd: pair durations follow the original server lease through a delayed claim and reconnect', async () => {
  const worker = start({ clock: true });
  let desktop;
  let replacement;
  try {
    desktop = await connectDesktop(worker);
    const first = await offer(desktop);
    duration(first, first.expiresAt, 0);
    const advance = (offset) =>
      poster(worker)('/__audit_clock', { deviceId: desktop.deviceId, offset });
    await advance(120_000);
    const claimed = await desktop.post(
      '/api/pair/claim',
      {
        v: 1,
        deviceId: desktop.deviceId,
        code: first.code,
        clientLabel: 'Delayed synthetic phone',
        requestedScopes: ['read'],
      },
      { Origin: ORIGIN },
    );
    assert.equal(claimed.status, 202);
    duration(await claimed.json(), first.expiresAt, 120_000);
    const request = await desktop.inbox.next('pair.request');
    duration(request, first.expiresAt, 120_000);
    const cookie = cookieValue(claimed);
    const status = async () =>
      worker.dispatchFetch(`${ORIGIN}/api/pair/status`, { headers: { Cookie: cookie } });
    const pending = await (await status()).json();
    assert.equal(pending.status, 'pending');
    assert.ok(pending.expiresInMs > 0 && pending.expiresInMs <= request.expiresInMs);
    await advance(150_000);
    replacement = await connectDesktop(worker, desktop);
    const replayed = await replacement.inbox.next('pair.request');
    assert.equal(replayed.pairingId, request.pairingId);
    duration(replayed, first.expiresAt, 150_000);
    assert.ok(replayed.expiresInMs < request.expiresInMs);
    await advance(301_000);
    assert.equal((await status()).status, 401);
    replacement.send({
      type: 'pair.decide',
      pairingId: request.pairingId,
      approved: true,
      scopes: ['read'],
    });
    replacement.send({ type: 'clients.list', requestId: crypto.randomUUID() });
    const clients = await replacement.inbox.next('clients');
    assert.deepEqual(clients.clients, []);
  } finally {
    closeSocket(desktop?.socket);
    closeSocket(replacement?.socket);
    await worker.dispose();
  }
});

test('real workerd: a superseded fresh offer cannot claim or prompt; the latest code remains pending and one use', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const older = await offer(desktop);
    const latest = await offer(desktop);
    const claim = (code, headers = { Origin: ORIGIN }) =>
      desktop.post(
        '/api/pair/claim',
        {
          v: 1,
          deviceId: desktop.deviceId,
          code,
          clientLabel: 'Synthetic phone',
          requestedScopes: ['read'],
        },
        headers,
      );
    assert.equal((await claim(older.code)).status, 403);
    assert.equal((await claim(latest.code, {})).status, 403);
    assert.equal((await claim(latest.code, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal(
      desktop.inbox.queue.some((message) => message.type === 'pair.request'),
      false,
    );
    const accepted = await claim(latest.code);
    assert.equal(accepted.status, 202);
    const request = await desktop.inbox.next('pair.request');
    duration(request, latest.expiresAt, 0);
    assert.equal((await claim(latest.code)).status, 403);
    const pending = await worker.dispatchFetch(`${ORIGIN}/api/session`, {
      headers: { Cookie: cookieValue(accepted) },
    });
    assert.equal((await pending.json()).status, 'pending');
    assert.equal(
      desktop.inbox.queue.some((message) => message.type === 'pair.request'),
      false,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});
