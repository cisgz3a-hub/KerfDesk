import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ORIGIN,
  start,
  connectDesktop,
  pairPhone,
  poster,
  workspace,
  cookieValue,
  offer,
  authorizeMcp,
} from './support.mjs';
import {
  closeSocket,
  prepareConsent,
  redeem,
  mcpPost,
  toolCall,
  editArguments,
  startKvFaultWorker,
} from './post-release-support.mjs';

test('post-release workerd: a consent form cannot silently switch to a different paired PC', async () => {
  const worker = start();
  let first;
  let second;
  try {
    const firstIdentity = {
      deviceId: randomUUID(),
      ownerSecret: randomBytes(32).toString('base64url'),
    };
    assert.equal(
      (
        await poster(worker)('/api/desktop/register', {
          v: 1,
          ...firstIdentity,
          label: 'First consent PC',
        })
      ).status,
      200,
    );
    first = await connectDesktop(worker, firstIdentity);
    second = await connectDesktop(worker);
    const firstPhone = await pairPhone(worker, first);
    const consent = await prepareConsent(worker, firstPhone);
    assert.match(consent.html, /First consent PC/);
    const secondPhone = await pairPhone(worker, second);
    const ownToken = secondPhone.cookie.split('=')[1].split('.')[2];
    const ownDigest = createHash('sha256').update(ownToken).digest('hex');
    const swapped = await consent.approve(
      secondPhone.cookie,
      ['kerfdesk:read', 'kerfdesk:edit', 'offline_access'],
      [
        ['deviceId', second.deviceId],
        ['clientId', secondPhone.clientId],
        ['sessionDigest', ownDigest],
        ['scope_limit', 'kerfdesk:read kerfdesk:edit offline_access'],
      ],
    );
    if (swapped.status === 303) {
      const tokenResponse = await redeem(worker, consent.tokenForm(swapped));
      assert.equal(tokenResponse.status, 200);
      const credentials = await tokenResponse.json();
      const exchange = await mcpPost(worker, credentials, toolCall(1, 'get_workspace'));
      assert.equal(exchange.status, 200);
      const misdirected = await second.inbox.next('command');
      assert.equal(misdirected.clientId, secondPhone.clientId);
      second.send({ type: 'result', requestId: misdirected.requestId, result: workspace });
      assert.match(await exchange.text(), /Synthetic audit workspace/);
    }
    assert.notEqual(
      swapped.status,
      303,
      'Consent names the first PC and must not mint a code for the replacement PC cookie.',
    );
    assert.equal(
      first.inbox.queue.some((message) => message.type === 'command'),
      false,
    );
    assert.equal(
      second.inbox.queue.some((message) => message.type === 'command'),
      false,
    );
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/api/session`, {
          headers: { Cookie: secondPhone.cookie },
        })
      ).status,
      200,
    );
  } finally {
    closeSocket(first?.socket);
    closeSocket(second?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: consent can narrow edit-approved PC permission to read-only access', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const consent = await prepareConsent(worker, phone);
    const approval = await consent.approve(phone.cookie, ['kerfdesk:read']);
    const tokenResponse = await redeem(worker, consent.tokenForm(approval));
    assert.equal(tokenResponse.status, 200);
    const credentials = await tokenResponse.json();
    assert.deepEqual(credentials.scope.split(' '), ['kerfdesk:read']);
    assert.equal(credentials.refresh_token, undefined);
    const deniedEdit = await mcpPost(
      worker,
      credentials,
      toolCall(2, 'add_rectangle', editArguments()),
    );
    assert.equal(deniedEdit.status, 403);
    assert.equal((await deniedEdit.json()).error, 'insufficient_scope');
    assert.equal(
      desktop.inbox.queue.some((message) => message.type === 'command'),
      false,
    );
    const exchange = await mcpPost(worker, credentials, toolCall(3, 'get_workspace'));
    const read = await desktop.inbox.next('command');
    assert.deepEqual(read.scopes, ['read']);
    desktop.send({ type: 'result', requestId: read.requestId, result: workspace });
    assert.match(await exchange.text(), /Synthetic audit workspace/);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: declining consent clears its binding and cannot be reused to grant access', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const consent = await prepareConsent(worker, phone);
    const declined = await consent.decline();
    assert.equal(declined.status, 303);
    const callback = new URL(declined.headers.get('Location'));
    assert.equal(callback.searchParams.get('error'), 'access_denied');
    assert.equal(callback.searchParams.get('code'), null);
    const kv = await worker.getKVNamespace('OAUTH_KV');
    const key = `kerfdesk:consent-binding:v1:${createHash('sha256').update(consent.handle).digest('hex')}`;
    assert.equal(await kv.get(key), null);
    assert.equal((await consent.approve()).status, 403);
    const fresh = await prepareConsent(worker, phone, { scope: 'kerfdesk:read' });
    assert.equal((await redeem(worker, fresh.tokenForm(await fresh.approve()))).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: simultaneous Allow submissions for the same consent can authorize only once', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const consent = await prepareConsent(worker, phone);
    const results = await Promise.all([consent.approve(), consent.approve()]);
    const allowed = results.filter((response) => response.status === 303);
    assert.equal(
      allowed.length,
      1,
      'A double submission must not create two authorization codes from one consent.',
    );
    assert.equal((await redeem(worker, consent.tokenForm(allowed[0]))).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: missing and expired server bindings refuse consent while a fresh page still works', async () => {
  const worker = start({ clock: true });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const missing = await prepareConsent(worker, phone);
    const kv = await worker.getKVNamespace('OAUTH_KV');
    const key = `kerfdesk:consent-binding:v1:${createHash('sha256').update(missing.handle).digest('hex')}`;
    const stored = await kv.get(key, 'json');
    assert.equal(stored.deviceId, desktop.deviceId);
    assert.equal(stored.clientId, phone.clientId);
    assert.equal(JSON.stringify(stored).includes(phone.cookie.split('=')[1].split('.')[2]), false);
    await kv.delete(key);
    assert.equal((await missing.approve()).status, 403);
    const expired = await prepareConsent(worker, phone);
    await poster(worker)('/__audit_clock', { deviceId: desktop.deviceId, offset: 601_000 });
    assert.equal((await expired.approve()).status, 403);
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: phone.cookie } }))
        .status,
      200,
    );
    const fresh = await prepareConsent(worker, phone);
    assert.equal((await redeem(worker, fresh.tokenForm(await fresh.approve()))).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: duplicate handle, decision and scope fields cannot consume a valid consent', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const consent = await prepareConsent(worker, phone, { scope: 'kerfdesk:read' });
    for (const field of [
      ['handle', consent.handle],
      ['decision', 'deny'],
      ['scope', 'kerfdesk:read'],
    ])
      assert.equal((await consent.approve(phone.cookie, ['kerfdesk:read'], [field])).status, 403);
    assert.equal((await redeem(worker, consent.tokenForm(await consent.approve()))).status, 200);
    assert.equal((await consent.approve()).status, 403);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: a read-only PC approval cannot be enlarged by an OAuth form or tool call', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'edit'], ['read']);
    assert.deepEqual(phone.session.client.scopes, ['read']);
    const consent = await prepareConsent(worker, phone, { scope: 'kerfdesk:read' });
    assert.equal(
      (await consent.approve(phone.cookie, ['kerfdesk:read', 'kerfdesk:edit'])).status,
      403,
    );
    const tokenResponse = await redeem(worker, consent.tokenForm(await consent.approve()));
    assert.equal(tokenResponse.status, 200);
    const denied = await mcpPost(
      worker,
      await tokenResponse.json(),
      toolCall(4, 'add_rectangle', editArguments()),
    );
    assert.equal(denied.status, 403);
    assert.equal(
      desktop.inbox.queue.some((message) => message.type === 'command'),
      false,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: revoking PC permission after Allow but before PKCE exchange defeats old and re-paired cookies', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const consent = await prepareConsent(worker, phone);
    const tokenForm = consent.tokenForm(await consent.approve());
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    await desktop.inbox.next('clients', (message) => message.clients.length === 0);
    const denied = await redeem(worker, tokenForm);
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).error, 'invalid_grant');
    const renewedPhone = await pairPhone(worker, desktop);
    assert.notEqual(renewedPhone.clientId, phone.clientId);
    const replay = await redeem(worker, tokenForm);
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, 'invalid_grant');
    const fresh = await prepareConsent(worker, renewedPhone);
    assert.equal((await redeem(worker, fresh.tokenForm(await fresh.approve()))).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: phone self-revocation cancels its edit and preserves another phone’s pending read', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const editor = await pairPhone(worker, desktop);
    const viewer = await pairPhone(worker, desktop, ['read']);
    const editing = editor.post('/api/client/command', {
      name: 'add_rectangle',
      args: editArguments(),
    });
    const edit = await desktop.inbox.next(
      'command',
      (message) => message.clientId === editor.clientId,
    );
    const reading = viewer.post('/api/client/command', { name: 'get_workspace', args: {} });
    const read = await desktop.inbox.next(
      'command',
      (message) => message.clientId === viewer.clientId,
    );
    assert.equal((await editor.post('/api/client/revoke', {})).status, 200);
    assert.equal((await desktop.inbox.next('cancel')).requestId, edit.requestId);
    await desktop.inbox.next('clients', (message) => message.clients.length === 1);
    desktop.send({
      type: 'result',
      requestId: edit.requestId,
      result: { revision: 'late-edit', changedArtworkIds: ['late'] },
    });
    desktop.send({ type: 'result', requestId: read.requestId, result: workspace });
    const stopped = await editing;
    assert.equal(stopped.status, 400);
    assert.equal((await stopped.json()).error.code, 'cancelled');
    assert.equal((await reading).status, 200);
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: editor.cookie } }))
        .status,
      401,
    );
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: viewer.cookie } }))
        .status,
      200,
    );
    assert.equal(
      desktop.inbox.queue.some(
        (message) => message.type === 'cancel' && message.requestId === read.requestId,
      ),
      false,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: revoke all cancels phone editing and MCP reading, then rejects both credentials', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const credentials = await authorizeMcp(worker, phone);
    const editing = phone.post('/api/client/command', {
      name: 'add_rectangle',
      args: editArguments(),
    });
    const edit = await desktop.inbox.next('command');
    const exchange = await mcpPost(worker, credentials, toolCall(5, 'get_workspace'));
    const read = await desktop.inbox.next('command');
    desktop.send({ type: 'clients.revokeAll', requestId: randomUUID() });
    const cancelled = new Set([
      (await desktop.inbox.next('cancel')).requestId,
      (await desktop.inbox.next('cancel')).requestId,
    ]);
    assert.deepEqual(cancelled, new Set([edit.requestId, read.requestId]));
    await desktop.inbox.next('clients.revoked');
    desktop.send({ type: 'result', requestId: edit.requestId, result: { revision: 'late-edit' } });
    desktop.send({ type: 'result', requestId: read.requestId, result: workspace });
    assert.equal((await editing).status, 400);
    assert.match(await exchange.text(), /The request was cancelled/);
    assert.equal((await mcpPost(worker, credentials, toolCall(6, 'get_workspace'))).status, 401);
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: phone.cookie } }))
        .status,
      401,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: replacement desktop cannot accept an old edit result or inherit its active request', async () => {
  const worker = start();
  let desktop;
  let replacement;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const editing = phone.post('/api/client/command', {
      name: 'add_rectangle',
      args: editArguments(),
    });
    const old = await desktop.inbox.next('command');
    replacement = await connectDesktop(worker, desktop);
    const unavailable = await editing;
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'unavailable');
    replacement.send({
      type: 'result',
      requestId: old.requestId,
      result: { revision: 'old-connection-edit' },
    });
    assert.equal(
      replacement.inbox.queue.some((message) => message.type === 'command'),
      false,
    );
    const current = phone.post('/api/client/command', { name: 'get_workspace', args: {} });
    const fresh = await replacement.inbox.next('command');
    assert.notEqual(fresh.requestId, old.requestId);
    replacement.send({ type: 'result', requestId: fresh.requestId, result: workspace });
    assert.equal((await current).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    closeSocket(replacement?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: an expired claim and obsolete decision cannot approve the fresh code generation', async () => {
  const worker = start({ clock: true });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const old = await offer(desktop);
    const claim = (code) =>
      desktop.post(
        '/api/pair/claim',
        {
          v: 1,
          deviceId: desktop.deviceId,
          code,
          clientLabel: 'Generation audit',
          requestedScopes: ['read', 'edit'],
        },
        { Origin: ORIGIN },
      );
    const oldClaim = await claim(old.code);
    assert.equal(oldClaim.status, 202);
    const oldCookie = cookieValue(oldClaim);
    const oldRequest = await desktop.inbox.next('pair.request');
    await poster(worker)('/__audit_clock', { deviceId: desktop.deviceId, offset: 301_000 });
    const current = await offer(desktop);
    assert.notEqual(current.code, old.code);
    assert.equal((await claim(old.code)).status, 403);
    const freshClaim = await claim(current.code);
    assert.equal(freshClaim.status, 202);
    const freshCookie = cookieValue(freshClaim);
    const freshRequest = await desktop.inbox.next('pair.request');
    desktop.send({
      type: 'pair.decide',
      pairingId: oldRequest.pairingId,
      approved: true,
      scopes: ['read', 'edit'],
    });
    const requestId = randomUUID();
    desktop.send({ type: 'clients.list', requestId });
    assert.equal(
      (await desktop.inbox.next('clients', (message) => message.requestId === requestId)).clients
        .length,
      0,
    );
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: oldCookie } }))
        .status,
      401,
    );
    const pending = await (
      await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: freshCookie } })
    ).json();
    assert.equal(pending.status, 'pending');
    desktop.send({
      type: 'pair.decide',
      pairingId: freshRequest.pairingId,
      approved: true,
      scopes: ['read'],
    });
    await desktop.inbox.next('clients', (message) =>
      message.clients.some((client) => client.id === freshRequest.pairingId),
    );
    const approved = await (
      await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: freshCookie } })
    ).json();
    assert.deepEqual(approved.client.scopes, ['read']);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: consent binding write failure exposes no form or authorization and a fresh attempt recovers', async () => {
  const worker = startKvFaultWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    await poster(worker)('/__audit_kv_fault', { mode: 'put' });
    await assert.rejects(
      prepareConsent(worker, phone),
      (error) => error.actual === 503 && error.expected === 200,
    );
    await poster(worker)('/__audit_kv_fault', { mode: null });
    const fresh = await prepareConsent(worker, phone);
    assert.equal((await redeem(worker, fresh.tokenForm(await fresh.approve()))).status, 200);
    assert.equal(
      desktop.inbox.queue.some((message) => message.type === 'command'),
      false,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: consent binding read failure leaves provider consent available after recovery', async () => {
  const worker = startKvFaultWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const consent = await prepareConsent(worker, phone);
    await poster(worker)('/__audit_kv_fault', { mode: 'get' });
    const unavailable = await consent.approve();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Location'), null);
    await poster(worker)('/__audit_kv_fault', { mode: null });
    assert.equal((await redeem(worker, consent.tokenForm(await consent.approve()))).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: cleanup failure after provider consent consumption needs a fresh page and grants nothing', async () => {
  const worker = startKvFaultWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const consent = await prepareConsent(worker, phone);
    await poster(worker)('/__audit_kv_fault', { mode: 'delete' });
    const unavailable = await consent.approve();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Location'), null);
    await poster(worker)('/__audit_kv_fault', { mode: null });
    assert.notEqual((await consent.approve()).status, 303);
    const fresh = await prepareConsent(worker, phone);
    assert.equal((await redeem(worker, fresh.tokenForm(await fresh.approve()))).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: revoked and renewed pairing on the same PC requires a fresh consent form', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const oldPhone = await pairPhone(worker, desktop);
    const oldConsent = await prepareConsent(worker, oldPhone);
    desktop.send({ type: 'client.revoke', clientId: oldPhone.clientId });
    await desktop.inbox.next('clients', (message) => message.clients.length === 0);
    const renewedPhone = await pairPhone(worker, desktop);
    assert.notEqual(renewedPhone.clientId, oldPhone.clientId);
    const stale = await oldConsent.approve(renewedPhone.cookie);
    assert.notEqual(
      stale.status,
      303,
      'A new PC permission must not inherit a consent page for the revoked client lease.',
    );
    const freshConsent = await prepareConsent(worker, renewedPhone);
    const approved = await freshConsent.approve();
    assert.equal((await redeem(worker, freshConsent.tokenForm(approved))).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('post-release workerd: hidden form changes cannot grant edit or offline scopes absent from the consent page', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const readConsent = await prepareConsent(worker, phone, { scope: 'kerfdesk:read' });
    assert.equal(readConsent.html.includes('Add text and rectangles'), false);
    assert.equal(
      readConsent.html.includes('Reconnect with this approval for up to 30 days'),
      false,
    );
    const enlarged = await readConsent.approve(phone.cookie, [
      'kerfdesk:read',
      'kerfdesk:edit',
      'offline_access',
    ]);
    if (enlarged.status === 303) {
      const token = await redeem(worker, readConsent.tokenForm(enlarged));
      assert.equal(token.status, 200);
      const credentials = await token.json();
      assert.ok(credentials.scope.split(' ').includes('kerfdesk:edit'));
      assert.ok(credentials.refresh_token);
    }
    assert.notEqual(
      enlarged.status,
      303,
      'PC permission is a ceiling; OAuth consent must only grant the scopes actually shown.',
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});
