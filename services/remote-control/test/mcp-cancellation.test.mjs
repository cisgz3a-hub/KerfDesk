import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  ORIGIN,
  start,
  connectDesktop,
  pairPhone,
  authorizeMcp,
  workspace,
  directFetcher,
} from './support.mjs';

const closeSocket = (socket) => {
  if (socket && socket.readyState < 2) socket.close();
};
function mcpPost(fetch, credentials, message) {
  return fetch(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify(message),
  });
}
const tool = (id) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'get_workspace', arguments: {} },
});
const cancel = (requestId) => ({
  jsonrpc: '2.0',
  method: 'notifications/cancelled',
  params: { requestId },
});

test(
  'real workerd: legacy SDK cancellation notification cancels the exact desktop request and ignores a late success',
  { timeout: 15_000 },
  async () => {
    const worker = start({
      extra: {
        assets: undefined,
        unsafeDirectSockets: [{ host: '127.0.0.1', port: 0, proxy: true }],
      },
    });
    let desktop;
    let client;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const credentials = await authorizeMcp(worker, phone);
      const fetch = await directFetcher(worker);
      const methods = [];
      client = new Client(
        { name: 'synthetic-legacy-cancellation', version: '1' },
        { versionNegotiation: { mode: 'legacy' } },
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
        fetch(url, init = {}) {
          const headers = new Headers(init.headers);
          headers.set('Authorization', `Bearer ${credentials.access_token}`);
          if (init.body) methods.push(JSON.parse(init.body).method);
          return fetch(url, { ...init, headers });
        },
      });
      await client.connect(transport);
      const abort = new AbortController();
      const call = client.callTool(
        { name: 'get_workspace', arguments: {} },
        { signal: abort.signal },
      );
      const rejected = assert.rejects(
        call,
        (error) => error.name === 'AbortError' || error.message.includes('AbortError'),
      );
      const command = await desktop.inbox.next('command');
      abort.abort();
      await rejected;
      assert.equal((await desktop.inbox.next('cancel')).requestId, command.requestId);
      assert.ok(methods.includes('notifications/cancelled'));
      desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
      const next = client.callTool({ name: 'get_workspace', arguments: {} });
      const nextCommand = await desktop.inbox.next('command');
      desktop.send({ type: 'result', requestId: nextCommand.requestId, result: workspace });
      assert.deepEqual((await next).structuredContent, workspace);
    } finally {
      await client?.close();
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test(
  'real workerd: cancellation separates OAuth apps, grants and numeric/string request IDs on one paired browser',
  { timeout: 20_000 },
  async () => {
    const worker = start({
      extra: {
        assets: undefined,
        unsafeDirectSockets: [{ host: '127.0.0.1', port: 0, proxy: true }],
      },
    });
    let desktop;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const first = await authorizeMcp(worker, phone);
      const otherApp = await authorizeMcp(worker, phone);
      const fetch = await directFetcher(worker);
      const exchange = await mcpPost(fetch, first, tool(2));
      assert.equal(exchange.status, 200, `Expected a streamed tool exchange (${exchange.status}).`);
      const command = await desktop.inbox.next('command');
      assert.equal((await mcpPost(fetch, otherApp, cancel(2))).status, 202);
      assert.equal(
        desktop.inbox.queue.some(
          (value) => value.type === 'cancel' && value.requestId === command.requestId,
        ),
        false,
      );
      assert.equal(
        (await mcpPost(fetch, first, tool(2))).status,
        503,
        'A duplicate active wire ID must not overwrite its association.',
      );
      const stringExchange = await mcpPost(fetch, first, tool('2'));
      const stringCommand = await desktop.inbox.next('command');
      assert.equal((await mcpPost(fetch, first, cancel('2'))).status, 202);
      assert.equal((await desktop.inbox.next('cancel')).requestId, stringCommand.requestId);
      assert.match(await stringExchange.text(), /The request was cancelled/);
      desktop.send({ type: 'result', requestId: stringCommand.requestId, result: workspace });
      // The library replaces this client's old grant. Its already admitted request has a
      // different encrypted association and must not be targeted by the new authorization.
      const otherGrant = await authorizeMcp(worker, phone, undefined, { clientId: first.clientId });
      assert.equal((await mcpPost(fetch, first, cancel(2))).status, 401);
      assert.equal((await mcpPost(fetch, otherGrant, cancel(2))).status, 202);
      const newer = await mcpPost(fetch, otherGrant, tool(2));
      assert.equal(newer.status, 200);
      const newerCommand = await desktop.inbox.next('command');
      assert.equal((await mcpPost(fetch, otherGrant, cancel(2))).status, 202);
      assert.equal((await desktop.inbox.next('cancel')).requestId, newerCommand.requestId);
      assert.match(await newer.text(), /The request was cancelled/);
      desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
      assert.match(await exchange.text(), /Synthetic audit workspace/);
      const beforeRefresh = await mcpPost(fetch, otherGrant, tool(100));
      const refreshCommand = await desktop.inbox.next('command');
      const refresh = await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: otherGrant.clientId,
          refresh_token: otherGrant.refresh_token,
          resource: `${ORIGIN}/mcp`,
        }).toString(),
      });
      assert.equal(refresh.status, 200);
      const renewed = await refresh.json();
      assert.equal((await mcpPost(fetch, renewed, cancel(100))).status, 202);
      assert.equal((await desktop.inbox.next('cancel')).requestId, refreshCommand.requestId);
      assert.match(await beforeRefresh.text(), /The request was cancelled/);
      for (let id = 10; id < 45; id++) {
        const response = await mcpPost(fetch, renewed, tool(id));
        assert.equal(response.status, 200);
        const later = await desktop.inbox.next('command');
        desktop.send({ type: 'result', requestId: later.requestId, result: workspace });
        assert.match(await response.text(), /Synthetic audit workspace/);
      }
      assert.equal((await mcpPost(fetch, renewed, tool('x'.repeat(513)))).status, 400);
    } finally {
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test(
  'real workerd: cancellation before dispatch and replacement desktop deny the reserved exchange',
  { timeout: 15_000 },
  async () => {
    const worker = start();
    let desktop;
    let replacement;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const props = {
        deviceId: desktop.deviceId,
        clientId: phone.clientId,
        leaseId: phone.session.leaseId,
      };
      const namespace = await worker.getDurableObjectNamespace('REMOTE_DEVICES');
      const stub = namespace.get(namespace.idFromName(desktop.deviceId));
      const session = await stub.session(
        phone.clientId,
        createHash('sha256').update(phone.cookie.split('.').at(-1)).digest('hex'),
      );
      props.leaseId = session.leaseId;
      const key = createHash('sha256').update('synthetic-cancel-before-dispatch').digest('hex');
      assert.equal(await stub.beginMcpRequest(props, ['read'], key), true);
      await stub.cancelMcpRequest(props, ['read'], key);
      const run = async () =>
        JSON.parse(
          await stub.runCommand(
            props,
            ['read'],
            crypto.randomUUID(),
            JSON.stringify({ name: 'get_workspace', args: {} }),
            undefined,
            key,
          ),
        );
      assert.equal((await run()).error.code, 'cancelled');
      await stub.endMcpRequest(props, key);
      assert.equal(await stub.beginMcpRequest(props, ['read'], key), true);
      replacement = await connectDesktop(worker, {
        deviceId: desktop.deviceId,
        ownerSecret: desktop.ownerSecret,
      });
      assert.equal((await run()).error.code, 'cancelled');
      await stub.endMcpRequest(props, key);
      assert.equal(
        replacement.inbox.queue.some((value) => value.type === 'command'),
        false,
      );
      const reserved = [];
      for (let index = 0; index < 33; index++) {
        const boundedKey = createHash('sha256').update(`synthetic-capacity-${index}`).digest('hex');
        reserved.push(boundedKey);
        assert.equal(await stub.beginMcpRequest(props, ['read'], boundedKey), index < 32);
      }
      await stub.endMcpRequest(props, reserved[0]);
      assert.equal(await stub.beginMcpRequest(props, ['read'], reserved[32]), true);
      for (const boundedKey of reserved) await stub.endMcpRequest(props, boundedKey);
    } finally {
      closeSocket(desktop?.socket);
      closeSocket(replacement?.socket);
      await worker.dispose();
    }
  },
);
