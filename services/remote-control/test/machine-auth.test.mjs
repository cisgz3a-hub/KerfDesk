import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  ORIGIN,
  start,
  connectDesktop,
  pairPhone,
  authorizeMcp,
  offer,
  cookieValue,
} from './support.mjs';
import { controlWitness, operationReceipt, startControlWorker } from './control-support.mjs';

const controls = () => {
  const admission = () => ({ expectedRevision: 'audit-1', requestId: randomUUID() });
  return {
    jog_machine: { ...admission(), axis: 'x', direction: 1, distanceMm: 1 },
    frame_job: admission(),
    review_machine_job: admission(),
    start_job: { ...admission(), reviewId: randomUUID() },
    abort_job: { requestId: randomUUID() },
  };
};
const close = (desktop) => {
  if (desktop?.socket.readyState < 2) desktop.socket.close();
};
const mcpCall = (worker, token, name, args) =>
  worker.dispatchFetch(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

test('real workerd: existing read/edit OAuth and phone grants cannot control machines', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const credentials = await authorizeMcp(worker, phone);
    for (const [name, args] of Object.entries(controls())) {
      const response = await mcpCall(worker, credentials.access_token, name, args);
      assert.equal(response.status, 403, name);
      assert.equal((await response.json()).error, 'insufficient_scope');
      assert.match(
        response.headers.get('WWW-Authenticate'),
        /scope="kerfdesk:read kerfdesk:control"/,
      );
      assert.doesNotMatch(response.headers.get('WWW-Authenticate'), /kerfdesk:edit/);
      const denied = await phone.post('/api/client/command', { name, args });
      assert.equal(denied.status, 503, name);
      assert.equal((await denied.json()).error.code, 'unavailable');
    }
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: control approval does not elevate a read-only token or grant artwork editing', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const read = await authorizeMcp(worker, phone, 'kerfdesk:read');
    const denied = await mcpCall(worker, read.access_token, 'abort_job', controls().abort_job);
    assert.equal(denied.status, 403);
    const edit = await phone.post('/api/client/command', {
      name: 'add_rectangle',
      args: {
        expectedRevision: 'audit-1',
        requestId: randomUUID(),
        xMm: 0,
        yMm: 0,
        widthMm: 10,
        heightMm: 10,
      },
    });
    assert.equal(edit.status, 503);
    assert.equal((await edit.json()).error.code, 'unavailable');
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: desktop subset approval cannot add an unrequested control scope or issue elevated consent', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const pairing = await offer(desktop);
    const claim = await desktop.post(
      '/api/pair/claim',
      {
        v: 1,
        deviceId: desktop.deviceId,
        code: pairing.code,
        clientLabel: 'Synthetic subset approval',
        requestedScopes: ['read', 'edit'],
      },
      { Origin: ORIGIN },
    );
    assert.equal(claim.status, 202);
    const request = await desktop.inbox.next('pair.request');
    desktop.send({
      type: 'pair.decide',
      pairingId: request.pairingId,
      approved: true,
      scopes: ['read', 'control'],
    });
    const verifyId = randomUUID();
    desktop.send({ type: 'clients.list', requestId: verifyId });
    const snapshot = await desktop.inbox.next('clients', (item) => item.requestId === verifyId);
    assert.deepEqual(snapshot.clients, []);
    const pending = await worker.dispatchFetch(`${ORIGIN}/api/session`, {
      headers: { Cookie: cookieValue(claim) },
    });
    assert.equal((await pending.json()).status, 'pending');
    const rejected = await pairPhone(
      worker,
      desktop,
      ['read', 'edit', 'control'],
      ['read', 'edit'],
    );
    await assert.rejects(
      authorizeMcp(worker, rejected, 'kerfdesk:read kerfdesk:control'),
      /Synthetic consent absent/,
    );
    const response = await rejected.post('/api/client/command', {
      name: 'frame_job',
      args: controls().frame_job,
    });
    assert.equal(response.status, 503);
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

for (const modern of [false, true]) {
  test(`real workerd: SDK machine tools advertise exact control scope and consequential annotations (modern=${modern})`, async () => {
    const worker = start();
    let desktop;
    let client;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop, ['read', 'control']);
      const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:control');
      client = new Client(
        { name: 'machine-authorization-test', version: '1' },
        modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
          fetch: (url, init = {}) => {
            const headers = new Headers(init.headers);
            headers.set('Authorization', `Bearer ${credentials.access_token}`);
            return worker.dispatchFetch(url, { ...init, headers });
          },
        }),
      );
      const tools = (await client.listTools()).tools;
      for (const name of Object.keys(controls())) {
        const tool = tools.find((item) => item.name === name);
        assert.deepEqual(tool._meta.securitySchemes, [
          { type: 'oauth2', scopes: ['kerfdesk:read', 'kerfdesk:control'] },
        ]);
        assert.deepEqual(tool.annotations, {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        });
        assert.equal(tool._meta.ui.resourceUri, 'ui://kerfdesk/workspace/v5.html');
      }
      assert.match(
        tools.find((tool) => tool.name === 'start_job').description,
        /explicitly chosen Start/,
      );
      const args = controls().jog_machine;
      const pending = client.callTool({ name: 'jog_machine', arguments: args });
      void pending.catch(() => undefined);
      const sent = await desktop.inbox.next('command');
      assert.deepEqual(sent.scopes, ['read', 'control']);
      assert.equal(sent.clientId, phone.clientId);
      desktop.send({ type: 'result', requestId: sent.requestId, result: operationReceipt(sent) });
      const result = (await pending).structuredContent;
      assert.equal(result.operation.state, 'accepted');
      assert.equal(result.operation.operationId, args.requestId);
      assert.equal(result.operation.committed, false);
      const malformed = await phone.post('/api/client/command', {
        name: 'jog_machine',
        args: { ...args, requestId: randomUUID(), distanceMm: 101 },
      });
      assert.equal(malformed.status, 400);
      assert.equal(
        desktop.inbox.queue.some((item) => item.type === 'command'),
        false,
      );
    } finally {
      await client?.close();
      close(desktop);
      await worker.dispose();
    }
  });
}

test('real workerd: correlated client snapshots report actual current control lifetime and expired clients disappear', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const snapshot = async () => {
      const requestId = randomUUID();
      desktop.send({ type: 'clients.list', requestId });
      return (await desktop.inbox.next('clients', (item) => item.requestId === requestId)).clients;
    };
    const [client] = await snapshot();
    assert.equal(client.id, phone.clientId);
    assert.ok(client.controlExpiresInMs > 0 && client.controlExpiresInMs <= 8 * 3600000);
    await controlWitness(worker, desktop.deviceId, 'advance', { offset: 60_000 });
    const [aged] = await snapshot();
    assert.ok(aged.controlExpiresInMs < client.controlExpiresInMs - 59_000);
    await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:control offline_access');
    const [retained] = await snapshot();
    assert.ok(retained.controlExpiresInMs > 29 * 86400000);
    assert.ok(retained.controlExpiresInMs <= 30 * 86400000);
    await controlWitness(worker, desktop.deviceId, 'advance', { offset: 31 * 86400000 });
    assert.deepEqual(await snapshot(), []);
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: ordinary OAuth wire exhaustion cannot consume the separate control-only Abort reservation', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const reserve = (index, scopes = ['read'], priority = false) =>
      controlWitness(worker, desktop.deviceId, 'reserve-wire', {
        deviceId: desktop.deviceId,
        clientId: phone.clientId,
        key: index.toString(16).padStart(64, '0'),
        scopes,
        priority,
      });
    for (let index = 1; index <= 32; index++) assert.ok(await reserve(index));
    assert.equal(await reserve(33, ['read', 'control']), null);
    assert.equal(await reserve(34, ['read'], true), null);
    for (let index = 35; index < 39; index++)
      assert.ok(await reserve(index, ['read', 'control'], true));
    assert.equal(await reserve(39, ['read', 'control'], true), null);
  } finally {
    close(desktop);
    await worker.dispose();
  }
});
