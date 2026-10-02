import assert from 'node:assert/strict';
import test from 'node:test';
import { ORIGIN, start, connectDesktop, pairPhone, authorizeMcp } from './support.mjs';

test('real workerd: revoked PC approval challenges a still-valid OAuth access token', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read');
    const request = () =>
      worker.dispatchFetch(`${ORIGIN}/mcp`, {
        headers: { Authorization: `Bearer ${credentials.access_token}` },
      });
    // A valid bearer and current PC approval reach the stateless MCP handler.
    assert.equal((await request()).status, 405);
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    await desktop.inbox.next('clients', (value) => value.clients.length === 0);
    const revoked = await request();
    assert.equal(revoked.status, 401);
    assert.deepEqual(await revoked.json(), {
      error: 'invalid_token',
      error_description: 'This computer approval is unavailable.',
    });
    const challenge = revoked.headers.get('WWW-Authenticate');
    assert.match(challenge, /Bearer .*error="invalid_token"/);
    assert.match(challenge, /error_description="This computer approval is unavailable\."/);
    assert.ok(
      challenge.includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`),
    );
    assert.match(challenge, /scope="kerfdesk:read"/);
    assert.equal(
      desktop.inbox.queue.some((value) => value.type === 'command'),
      false,
    );
  } finally {
    if (desktop?.socket && desktop.socket.readyState < 2) desktop.socket.close();
    await worker.dispose();
  }
});
