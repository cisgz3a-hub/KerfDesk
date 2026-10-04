import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { ORIGIN, start, connectDesktop, pairPhone, authorizeMcp } from './support.mjs';

const admission = { expectedRevision: 'audit-1', requestId: randomUUID() };
const newWrites = {
  update_text: { ...admission, artworkId: 'art-1', patch: { text: 'Changed' } },
  arrange_artwork: { ...admission, artworkIds: ['art-1'], action: 'duplicate' },
  undo: admission,
  redo: admission,
  add_ellipse: { ...admission, xMm: 2, yMm: 4, widthMm: 10, heightMm: 20 },
  add_polyline: {
    ...admission,
    pointsMm: [
      { xMm: 2, yMm: 4 },
      { xMm: 10, yMm: 20 },
    ],
    closed: false,
  },
};

test('real workerd: every new write refuses read-only OAuth and phone grants before delivery', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read');
    for (const [name, args] of Object.entries(newWrites)) {
      const response = await worker.dispatchFetch(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credentials.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: randomUUID(),
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
      assert.equal(response.status, 403, name);
      assert.equal((await response.json()).error, 'insufficient_scope');
      assert.match(response.headers.get('WWW-Authenticate'), /kerfdesk:read kerfdesk:edit/);
      const phoneResponse = await phone.post('/api/client/command', { name, args });
      assert.equal(phoneResponse.status, 503, `${name} phone`);
      assert.equal((await phoneResponse.json()).error.code, 'unavailable');
    }
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    if (desktop?.socket.readyState < 2) desktop.socket.close();
    await worker.dispose();
  }
});

for (const modern of [false, true]) {
  test(`real workerd: new SDK authoring and private preview resource (modern=${modern})`, async () => {
    const worker = start();
    let desktop;
    let client;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const credentials = await authorizeMcp(worker, phone);
      client = new Client(
        { name: 'workspace-authoring-test', version: '1' },
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
      const preview = tools.find((tool) => tool.name === 'get_workspace_preview');
      assert.equal(preview._meta.ui.resourceUri, 'ui://kerfdesk/workspace/v4.html');
      assert.deepEqual(preview._meta.securitySchemes, [
        { type: 'oauth2', scopes: ['kerfdesk:read'] },
      ]);
      for (const [name, args] of Object.entries(newWrites)) {
        const call = client.callTool({ name, arguments: args });
        void call.catch(() => undefined);
        const command = await desktop.inbox.next('command');
        assert.deepEqual(command.command, { name, args });
        assert.deepEqual(command.scopes, ['read', 'edit']);
        const result = { revision: 'audit-2', history: { canUndo: true, canRedo: false } };
        desktop.send({
          type: 'result',
          requestId: command.requestId,
          result: { ...result, ownerSecret: 'private-result-marker' },
        });
        assert.deepEqual((await call).structuredContent, result);
      }
      const read = client.callTool({ name: 'get_workspace_preview', arguments: {} });
      void read.catch(() => undefined);
      const command = await desktop.inbox.next('command');
      const png =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6foAAAAASUVORK5CYII=';
      const result = {
        revision: 'audit-2',
        status: 'ready',
        preview: { mimeType: 'image/png', data: png, widthPx: 1, heightPx: 1 },
        viewport: { xMm: -16, yMm: -24, widthMm: 256, heightMm: 256 },
      };
      desktop.send({ type: 'result', requestId: command.requestId, result });
      const response = await read;
      assert.deepEqual(response.structuredContent, result);
      assert.deepEqual(
        response.content.filter((item) => item.type === 'image'),
        [{ type: 'image', mimeType: 'image/png', data: png }],
      );
      const resource = await client.readResource({ uri: preview._meta.ui.resourceUri });
      assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
      assert.match(resource.contents[0].text, /ui\/initialize/);
      assert.equal(
        desktop.inbox.queue.some((item) => item.type === 'command'),
        false,
      );
      desktop.send({ type: 'client.revoke', clientId: phone.clientId });
      await desktop.inbox.next('clients', (value) => value.clients.length === 0);
      await assert.rejects(client.readResource({ uri: preview._meta.ui.resourceUri }));
    } finally {
      await client?.close();
      if (desktop?.socket.readyState < 2) desktop.socket.close();
      await worker.dispose();
    }
  });
}
