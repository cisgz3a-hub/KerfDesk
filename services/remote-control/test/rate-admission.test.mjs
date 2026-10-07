import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { start, ORIGIN, connectDesktop, pairPhone, authorizeMcp, workspace } from './support.mjs';
import { operationReceipt } from './control-support.mjs';
import { mcpPost, toolCall, closeSocket } from './post-release-support.mjs';

const NETWORK = '198.51.100.73';
const phoneRequest = (worker, phone, name, args = {}, headers = {}) =>
  worker.dispatchFetch(`${ORIGIN}/api/client/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      Cookie: phone.cookie,
      'X-KerfDesk-CSRF': phone.session.csrf,
      'CF-Connecting-IP': NETWORK,
      ...headers,
    },
    body: JSON.stringify({ name, args }),
  });
function respond(desktop) {
  const sent = [];
  desktop.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'command') return;
    sent.push(message.command.name);
    desktop.send({
      type: 'result',
      requestId: message.requestId,
      result:
        message.command.name === 'abort_job' ? operationReceipt(message, 'completed') : workspace,
    });
  });
  return sent;
}
const consume = async (response, expected = 200) => {
  assert.equal(response.status, expected, await response.clone().text());
  return response.text();
};

test('workerd: two normal phones on one IP keep 80 polls/minute and approved Abort after public quota exhaustion', async () => {
  const worker = start({ rateLimit: 60 });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phones = [
      await pairPhone(worker, desktop, ['read', 'control']),
      await pairPhone(worker, desktop, ['read', 'control']),
    ];
    const sent = respond(desktop);
    for (let index = 0; index < 61; index++) {
      const denied = await worker.dispatchFetch(`${ORIGIN}/api/pair/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'CF-Connecting-IP': NETWORK,
        },
        body: '{}',
      });
      await consume(denied, index < 60 ? 400 : 429);
    }
    for (let index = 0; index < 80; index++)
      await consume(await phoneRequest(worker, phones[index % 2], 'get_workspace'));
    await consume(await phoneRequest(worker, phones[0], 'abort_job', { requestId: randomUUID() }));
    assert.equal(sent.filter((name) => name === 'get_workspace').length, 80);
    assert.equal(sent.filter((name) => name === 'abort_job').length, 1);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('workerd: phone and OAuth share the approved lease budget; ordinary exhaustion and IP changes cannot spend reserved Abort', async () => {
  const worker = start({ clientRateLimit: 3, abortRateLimit: 1 });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:control');
    const sent = respond(desktop);
    await consume(await phoneRequest(worker, phone, 'get_workspace'));
    await consume(await mcpPost(worker, credentials, toolCall(1, 'get_workspace')));
    await consume(await phoneRequest(worker, phone, 'get_workspace'));
    await consume(await phoneRequest(worker, phone, 'get_workspace'), 429);
    await consume(
      await phoneRequest(
        worker,
        phone,
        'get_workspace',
        {},
        { 'CF-Connecting-IP': '198.51.100.74' },
      ),
      429,
    );
    await consume(await mcpPost(worker, credentials, toolCall(2, 'get_workspace')), 429);
    await consume(
      await mcpPost(worker, credentials, toolCall(3, 'abort_job', { requestId: randomUUID() })),
    );
    const limited = await phoneRequest(worker, phone, 'abort_job', { requestId: randomUUID() });
    assert.equal(limited.headers.get('Retry-After'), '60');
    await consume(limited, 429);
    assert.equal(sent.filter((name) => name === 'get_workspace').length, 3);
    assert.equal(sent.filter((name) => name === 'abort_job').length, 1);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('workerd: bounded unauthenticated credential traffic cannot consume the separate Abort verification lane', async () => {
  const worker = start({ authRateLimit: 4 });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const sent = respond(desktop);
    for (let index = 0; index < 5; index++)
      await consume(
        await phoneRequest(worker, { cookie: '', session: { csrf: '' } }, 'get_workspace'),
        index < 4 ? 401 : 429,
      );
    await consume(await phoneRequest(worker, phone, 'get_workspace'), 429);
    await consume(await phoneRequest(worker, phone, 'abort_job', { requestId: randomUUID() }));
    for (let index = 0; index < 4; index++)
      await consume(
        await phoneRequest(worker, { cookie: '', session: { csrf: '' } }, 'abort_job', {
          requestId: randomUUID(),
        }),
        index < 3 ? 401 : 429,
      );
    assert.deepEqual(sent, ['abort_job']);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('workerd: reserved Abort still rejects missing CSRF, missing control, revoked approval and forged OAuth', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const readPhone = await pairPhone(worker, desktop, ['read']);
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:control');
    const sent = respond(desktop);
    await consume(
      await phoneRequest(
        worker,
        phone,
        'abort_job',
        { requestId: randomUUID() },
        { 'X-KerfDesk-CSRF': '' },
      ),
      403,
    );
    await consume(
      await phoneRequest(worker, readPhone, 'abort_job', { requestId: randomUUID() }),
      503,
    );
    await consume(
      await mcpPost(
        worker,
        { access_token: 'forged' },
        toolCall(1, 'abort_job', { requestId: randomUUID() }),
      ),
      401,
    );
    const revoked = await phone.post('/api/client/revoke', {});
    await consume(revoked);
    await consume(await phoneRequest(worker, phone, 'abort_job', { requestId: randomUUID() }), 401);
    await consume(
      await mcpPost(worker, credentials, toolCall(2, 'abort_job', { requestId: randomUUID() })),
      401,
    );
    assert.deepEqual(sent, []);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('workerd: reserved admission supports legacy Abort-only batches; mixed/invalid/oversized batches stay ordinary', async () => {
  const worker = start({ clientRateLimit: 1, abortRateLimit: 3 });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:control');
    const sent = respond(desktop);
    await consume(await phoneRequest(worker, phone, 'get_workspace'));
    const abort = (id) => toolCall(id, 'abort_job', { requestId: randomUUID() });
    await consume(await mcpPost(worker, credentials, [abort(1)]));
    await consume(await mcpPost(worker, credentials, [abort(2), abort(3)]));
    await consume(
      await mcpPost(worker, credentials, [abort(4), toolCall(5, 'get_workspace')]),
      429,
    );
    await consume(
      await mcpPost(worker, credentials, [
        abort(6),
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]),
      429,
    );
    await consume(await mcpPost(worker, credentials, [{ ...abort(7), id: null }]), 429);
    await consume(
      await mcpPost(
        worker,
        credentials,
        Array.from({ length: 101 }, (_, index) => abort(index + 10)),
      ),
      429,
    );
    await consume(await mcpPost(worker, credentials, [abort(8)]));
    await consume(await mcpPost(worker, credentials, [abort(9)]), 429);
    assert.equal(sent.filter((name) => name === 'get_workspace').length, 1);
    assert.equal(sent.filter((name) => name === 'abort_job').length, 4);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});
