import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ORIGIN, start, connectDesktop, messages, offer, cookieValue, poster } from './support.mjs';
import { pairPhone } from './support.mjs';

const close = (desktop) => desktop?.socket.close();

async function phoneSocket(worker, phone, headers = {}) {
  const response = await worker.dispatchFetch(`${ORIGIN}/api/client/socket`, {
    headers: { Upgrade: 'websocket', Cookie: phone.cookie, Origin: ORIGIN, ...headers },
  });
  if (response.status !== 101) return { status: response.status };
  const socket = response.webSocket;
  const inbox = messages(socket);
  socket.accept();
  return { status: 101, socket, inbox, send: (value) => socket.send(JSON.stringify(value)) };
}
/** The synthetic desktop answers every forwarded command with a canned result. */
function answer(desktop, respond) {
  desktop.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'command') return;
    const result = respond(message.command.name, message.command.args);
    if (result !== undefined)
      desktop.send({ type: 'result', requestId: message.requestId, result });
  });
}
const holdOperation = (operationId) => ({
  revision: 'audit-1',
  operation: { operationId, revision: 'audit-1', kind: 'hold', state: 'running', committed: true },
});

test('real workerd: KerfDesk Remote shell is served with its own CSP, manifest and worker', async () => {
  const worker = start();
  try {
    const page = await worker.dispatchFetch(`${ORIGIN}/app/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('Content-Type'), /text\/html/);
    const csp = page.headers.get('Content-Security-Policy');
    assert.match(csp, /manifest-src 'self'/);
    assert.match(csp, /worker-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:\/\/(?!kerfdesk-phone-control)/);
    assert.match(page.headers.get('Permissions-Policy'), /camera=\(self\)/);
    assert.match(await page.text(), /\/app\/app\.js/);
    const redirect = await worker.dispatchFetch(`${ORIGIN}/app`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('Location'), '/app/');
    for (const path of [
      '/app/app.js',
      '/app/app.css',
      '/app/sw.js',
      '/app/manifest.webmanifest',
      '/app/icon.svg',
      '/app/icon-maskable.svg',
      '/app/icon-192.png',
      '/app/icon-512.png',
      '/app/icon-maskable-512.png',
    ])
      assert.equal((await worker.dispatchFetch(`${ORIGIN}${path}`)).status, 200, path);
    const manifest = await (
      await worker.dispatchFetch(`${ORIGIN}/app/manifest.webmanifest`)
    ).json();
    assert.equal(manifest.scope, '/app/');
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
    for (const icon of manifest.icons)
      assert.equal((await worker.dispatchFetch(`${ORIGIN}${icon.src}`)).status, 200, icon.src);
    assert.equal((await worker.dispatchFetch(`${ORIGIN}/app/index.html.map`)).status, 404);
    assert.equal((await worker.dispatchFetch(`${ORIGIN}/app/../wrangler.jsonc`)).status, 404);
    // The legacy page keeps working for already-printed links.
    assert.equal((await worker.dispatchFetch(`${ORIGIN}/control`)).status, 200);
    assert.equal((await (await worker.dispatchFetch(`${ORIGIN}/health`)).json()).protocol, 2);
  } finally {
    await worker.dispose();
  }
});

test('real workerd: live phone socket needs the exact origin and an approved session', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    assert.equal(
      (await phoneSocket(worker, phone, { Origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal((await phoneSocket(worker, { cookie: '' })).status, 401);
    const noUpgrade = await worker.dispatchFetch(`${ORIGIN}/api/client/socket`, {
      headers: { Cookie: phone.cookie, Origin: ORIGIN },
    });
    assert.equal(noUpgrade.status, 426);
    const live = await phoneSocket(worker, phone);
    assert.equal(live.status, 101);
    const hello = await live.inbox.next('hello');
    assert.equal(hello.online, true);
    assert.equal(hello.revision, undefined);
    live.socket.close();
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: desktop change counters fan out and resolve wait_for_change without the PC', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    const live = await phoneSocket(worker, phone);
    await live.inbox.next('hello');
    // Before any counters: older desktops report unsupported, so clients fall back to polling.
    const unsupported = await phone.post('/api/client/command', {
      name: 'wait_for_change',
      args: { timeoutMs: 0 },
    });
    assert.equal((await unsupported.json()).result.reason, 'unsupported');
    desktop.send({ type: 'changed', revision: 'rev-1', machineSeq: 4 });
    const changed = await live.inbox.next('changed');
    assert.deepEqual([changed.revision, changed.machineSeq], ['rev-1', 4]);
    const stale = await phone.post('/api/client/command', {
      name: 'wait_for_change',
      args: { sinceRevision: 'rev-0', timeoutMs: 15000 },
    });
    assert.deepEqual((await stale.json()).result, {
      revision: 'rev-1',
      machineSeq: 4,
      changed: true,
      reason: 'workspace',
    });
    const idle = await phone.post('/api/client/command', {
      name: 'wait_for_change',
      args: { sinceRevision: 'rev-1', sinceMachineSeq: 4, timeoutMs: 0 },
    });
    assert.equal((await idle.json()).result.reason, 'timeout');
    const waiting = phone.post('/api/client/command', {
      name: 'wait_for_change',
      args: { sinceRevision: 'rev-1', sinceMachineSeq: 4, timeoutMs: 10000 },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    desktop.send({ type: 'changed', revision: 'rev-1', machineSeq: 5 });
    assert.deepEqual((await (await waiting).json()).result, {
      revision: 'rev-1',
      machineSeq: 5,
      changed: true,
      reason: 'machine',
    });
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
      'answered by the relay',
    );
    await live.inbox.next('changed', (item) => item.machineSeq === 5);
    // Malformed counters are ignored, never echoed.
    desktop.send({ type: 'changed', revision: 'x'.repeat(201), machineSeq: 6 });
    desktop.send({ type: 'changed', revision: 'rev-2', machineSeq: -1 });
    desktop.send({ type: 'event', kind: 'job.finished' });
    assert.equal((await live.inbox.next('event')).kind, 'job.finished');
    assert.equal(
      live.inbox.queue.some((item) => item.type === 'changed'),
      false,
    );
    live.socket.close();
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: held jog needs the phone socket, forwards heartbeats and releases on close', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    answer(desktop, (name, args) =>
      name === 'jog_hold_start' ? holdOperation(args.requestId) : undefined,
    );
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const start = (requestId = randomUUID()) =>
      phone.post('/api/client/command', {
        name: 'jog_hold_start',
        args: { expectedRevision: 'audit-1', requestId, axis: 'x', direction: 1 },
      });
    const withoutSocket = await start();
    assert.equal((await withoutSocket.json()).error.code, 'unavailable');
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
    const live = await phoneSocket(worker, phone);
    await live.inbox.next('hello');
    const requestId = randomUUID();
    const started = await (await start(requestId)).json();
    assert.equal(started.result.operation.kind, 'hold');
    live.send({ type: 'hold.beat', operationId: requestId });
    const beat = await desktop.inbox.next('hold.beat');
    assert.deepEqual([beat.clientId, beat.operationId], [phone.clientId, requestId]);
    live.send({ type: 'hold.beat', operationId: 'not-a-uuid' });
    live.socket.close();
    const release = await desktop.inbox.next('hold.release');
    assert.equal(release.clientId, phone.clientId);
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'hold.beat'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: view-only phones cannot send heartbeats and revocation closes the socket', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    const live = await phoneSocket(worker, phone);
    await live.inbox.next('hello');
    live.send({ type: 'hold.beat', operationId: randomUUID() });
    live.send({ type: 'ping' });
    await live.inbox.next('pong');
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'hold.beat'),
      false,
    );
    const closed = new Promise((resolve) => live.socket.addEventListener('close', resolve));
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    await closed;
    await desktop.inbox.next('hold.release', (item) => item.clientId === phone.clientId);
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: only an explicitly remembered phone keeps a 30-day session', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const pairing = await offer(desktop);
    const post = poster(worker);
    const claim = await post(
      '/api/pair/claim',
      {
        v: 1,
        deviceId: desktop.deviceId,
        code: pairing.code,
        clientLabel: 'Remembered phone',
        requestedScopes: ['read'],
      },
      { Origin: ORIGIN },
    );
    assert.equal(claim.status, 202);
    const cookie = cookieValue(claim);
    const request = await desktop.inbox.next('pair.request');
    desktop.send({
      type: 'pair.decide',
      pairingId: request.pairingId,
      approved: true,
      scopes: ['read'],
      remember: true,
    });
    await desktop.inbox.next('clients', (value) =>
      value.clients.some((client) => client.id === request.pairingId),
    );
    const session = await worker.dispatchFetch(`${ORIGIN}/api/session`, {
      headers: { Cookie: cookie },
    });
    assert.equal((await session.json()).status, 'approved');
    const maxAge = Number(/Max-Age=(\d+)/.exec(session.headers.get('Set-Cookie') ?? '')?.[1]);
    assert.ok(maxAge > 29 * 86400 && maxAge <= 30 * 86400, `Max-Age ${maxAge}`);
    const ordinary = await pairPhone(worker, desktop, ['read']);
    const ordinarySession = await worker.dispatchFetch(`${ORIGIN}/api/session`, {
      headers: { Cookie: ordinary.cookie },
    });
    const ordinaryAge = Number(
      /Max-Age=(\d+)/.exec(ordinarySession.headers.get('Set-Cookie') ?? '')?.[1],
    );
    assert.ok(ordinaryAge <= 8 * 3600, `Max-Age ${ordinaryAge}`);
  } finally {
    close(desktop);
    await worker.dispose();
  }
});
