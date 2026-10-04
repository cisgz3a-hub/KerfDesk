import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  ORIGIN,
  start,
  poster,
  connectDesktop,
  pairPhone,
  offer,
  workspace,
  authorizeMcp,
  cookieValue,
  directFetcher,
} from './support.mjs';
const closeSocket = (socket) => {
  if (socket && socket.readyState < 2) socket.close();
};

const readTools = [
  'get_workspace',
  'get_machine',
  'get_app_status',
  'list_material_recipes',
  'review_job',
  'get_workspace_preview',
  'list_fonts',
  'get_text',
  'get_machine_status',
  'get_control_operation',
];
const editTools = [
  'set_selection',
  'add_text',
  'add_rectangle',
  'transform_artwork',
  'update_operation',
  'update_text',
  'arrange_artwork',
  'undo',
  'redo',
];
const controlTools = ['jog_machine', 'frame_job', 'review_machine_job', 'start_job', 'abort_job'];

function assertToolCatalogue(tools) {
  assert.equal(tools.length, 24);
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [...readTools, ...editTools, ...controlTools].sort(),
  );
  for (const tool of tools) {
    const readOnly = readTools.includes(tool.name);
    const control = controlTools.includes(tool.name);
    assert.deepEqual(
      tool._meta?.securitySchemes,
      [
        {
          type: 'oauth2',
          scopes: control
            ? ['kerfdesk:read', 'kerfdesk:control']
            : readOnly
              ? ['kerfdesk:read']
              : ['kerfdesk:read', 'kerfdesk:edit'],
        },
      ],
      `${tool.name} OAuth scopes`,
    );
    assert.deepEqual(
      tool.annotations,
      {
        readOnlyHint: readOnly,
        destructiveHint:
          control ||
          (!readOnly && !['set_selection', 'add_text', 'add_rectangle'].includes(tool.name)),
        idempotentHint: readOnly,
        openWorldHint: false,
      },
      `${tool.name} annotations`,
    );
  }
}

test('real workerd: fixed origin, small metadata, no bearer URLs, no machine routes and safe static page', async () => {
  const worker = start();
  try {
    const health = await worker.dispatchFetch(`${ORIGIN}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).protocol, 1);
    assert.equal(health.headers.get('Cache-Control'), 'no-store, no-transform');
    assert.match(health.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.equal((await worker.dispatchFetch('https://foreign.example/health')).status, 403);
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/health`, {
          headers: { Origin: 'https://foreign.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/mcp?access_token=synthetic-audit-marker`)).status,
      400,
    );
    for (const path of ['/api/start', '/api/jog', '/api/file', '/api/shell'])
      assert.equal((await poster(worker)(path, {})).status, 404);
    const page = await worker.dispatchFetch(`${ORIGIN}/control`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('Content-Security-Policy'), /img-src 'self' data:;/);
    assert.match(await page.text(), /Approve this phone on the PC/);
    for (const path of [
      '/control-edit.js',
      '/control-model.js',
      '/control-workspace.js',
      '/control-live.js',
      '/control-drafts.js',
      '/control-pairing.js',
    ]) {
      const asset = await worker.dispatchFetch(`${ORIGIN}${path}`);
      assert.equal(asset.status, 200, path);
      assert.match(asset.headers.get('Content-Type'), /javascript/);
    }
    assert.equal((await worker.dispatchFetch(`${ORIGIN}/control-unknown.js`)).status, 404);
    const notices = await worker.dispatchFetch(`${ORIGIN}/third-party-notices.txt`);
    assert.equal(notices.status, 200);
    const noticeText = await notices.text();
    assert.match(noticeText, /Copyright \(c\) 2025 Cloudflare, Inc\./);
    assert.match(noticeText, /@modelcontextprotocol\/server@2\.2\.0/);
    assert.match(noticeText, /Apache License/);
    assert.match(noticeText, /MIT License/);
    const oversized = await poster(worker)('/api/desktop/register', { filler: 'x'.repeat(4097) });
    assert.equal(oversized.status, 413);
  } finally {
    await worker.dispose();
  }
});

test('real workerd: an existing device cannot be taken over, and the owner secret must be a header', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const collision = await desktop.post('/api/desktop/register', {
      v: 1,
      deviceId: desktop.deviceId,
      label: 'Another PC',
      ownerSecret: randomBytes(32).toString('base64url'),
    });
    assert.equal(collision.status, 401);
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/api/desktop/connect?deviceId=${desktop.deviceId}`, {
          headers: { Upgrade: 'websocket' },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await worker.dispatchFetch(
          `${ORIGIN}/api/desktop/connect?deviceId=${desktop.deviceId}&ownerSecret=${desktop.ownerSecret}`,
          { headers: { Upgrade: 'websocket' } },
        )
      ).status,
      400,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: pairing is one use, explicitly pending, scoped, cookie protected and five-attempt limited', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const first = await offer(desktop);
    assert.match(first.code, /^[A-Za-z0-9-]{12}$/);
    const claim = {
      v: 1,
      deviceId: desktop.deviceId,
      code: first.code,
      clientLabel: 'Phone',
      requestedScopes: ['read', 'edit'],
    };
    assert.equal((await desktop.post('/api/pair/claim', claim)).status, 403);
    const response = await desktop.post('/api/pair/claim', claim, { Origin: ORIGIN });
    assert.equal(response.status, 202);
    assert.match(response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
    const cookie = cookieValue(response);
    const pending = await (
      await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: cookie } })
    ).json();
    assert.equal(pending.status, 'pending');
    assert.equal((await desktop.post('/api/pair/claim', claim, { Origin: ORIGIN })).status, 403);
    const request = await desktop.inbox.next('pair.request');
    desktop.send({
      type: 'pair.decide',
      pairingId: request.pairingId,
      approved: false,
      scopes: ['read'],
    });
    await desktop.inbox.next('clients');
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: cookie } })).status,
      401,
    );
    const second = await offer(desktop);
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await desktop.post(
            '/api/pair/claim',
            { ...claim, code: 'WrongCode12' + i },
            { Origin: ORIGIN },
          )
        ).status,
        403,
      );
    assert.equal(
      (await desktop.post('/api/pair/claim', { ...claim, code: second.code }, { Origin: ORIGIN }))
        .status,
      403,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: commands use direct projected data, read permission denies editing, and CSRF is enforced', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read']);
    assert.equal(
      (
        await poster(worker, { Cookie: phone.cookie, Origin: ORIGIN })('/api/client/command', {
          name: 'get_workspace',
          args: {},
        })
      ).status,
      403,
    );
    const requestPromise = phone.post('/api/client/command', { name: 'get_workspace', args: {} });
    const command = await desktop.inbox.next('command');
    assert.equal(command.clientId, phone.clientId);
    assert.deepEqual(command.scopes, ['read']);
    assert.deepEqual(command.command, { name: 'get_workspace', args: {} });
    desktop.send({
      type: 'result',
      requestId: command.requestId,
      result: {
        ...workspace,
        licenseKey: 'synthetic-private-marker',
        secretPath: 'synthetic-private-path',
      },
    });
    const response = await requestPromise;
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.result, workspace);
    assert.equal(JSON.stringify(data).includes('synthetic-private'), false);
    const denied = await phone.post('/api/client/command', {
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
    assert.equal(denied.status, 503);
    assert.equal((await denied.json()).error.code, 'unavailable');
    assert.equal(
      (await phone.post('/api/client/command', { name: 'start', args: {} })).status,
      400,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: revoke cancels a pending request and a late success cannot undo revocation', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const waiting = phone.post('/api/client/command', { name: 'get_workspace', args: {} });
    const command = await desktop.inbox.next('command');
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    const cancel = await desktop.inbox.next('cancel');
    assert.equal(cancel.requestId, command.requestId);
    await desktop.inbox.next('clients', (value) => value.clients.length === 0);
    desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
    const result = await waiting;
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error.code, 'cancelled');
    assert.equal(
      (await phone.post('/api/client/command', { name: 'get_workspace', args: {} })).status,
      401,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: replacement connection cancels old pending work, retains clients, and never replays', async () => {
  const worker = start();
  let desktop;
  let replacement;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const waiting = phone.post('/api/client/command', { name: 'get_workspace', args: {} });
    await desktop.inbox.next('command');
    replacement = await connectDesktop(worker, desktop);
    const response = await waiting;
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'unavailable');
    replacement.send({ type: 'clients.list', requestId: randomUUID() });
    const list = await replacement.inbox.next('clients');
    assert.equal(list.clients[0].id, phone.clientId);
    assert.equal(
      replacement.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    closeSocket(desktop?.socket);
    closeSocket(replacement?.socket);
    await worker.dispose();
  }
});

test('real workerd: official OAuth PKCE flow and SDK clients work in legacy and 2026-07-28 eras', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const credentials = await authorizeMcp(worker, phone);
    assert.ok(credentials.access_token);
    assert.ok(credentials.refresh_token);
    for (const modern of [false, true]) {
      const client = new Client(
        { name: 'synthetic-phone-audit', version: '1' },
        modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
        fetch: (url, init = {}) => {
          const headers = new Headers(init.headers);
          headers.set('Authorization', `Bearer ${credentials.access_token}`);
          return worker.dispatchFetch(url, { ...init, headers });
        },
      });
      try {
        await client.connect(transport);
        const tools = (await client.listTools()).tools;
        assertToolCatalogue(tools);
        const call = client.callTool({ name: 'get_workspace', arguments: {} });
        const command = await desktop.inbox.next('command');
        assert.deepEqual(command.scopes, ['read', 'edit']);
        desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
        assert.deepEqual((await call).structuredContent, workspace);
      } finally {
        await client.close();
      }
    }
    // The consumed application binding refuses consent replay before provider work;
    // the provider separately refuses an authorization code replay.
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/authorize`, {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            Cookie: credentials.cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: credentials.form,
        })
      ).status,
      403,
    );
    const replay = await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: credentials.tokenForm,
    });
    assert.equal(replay.status, 400);
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    await desktop.inbox.next('clients', (value) => value.clients.length === 0);
    const revoked = await worker.dispatchFetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
    });
    assert.equal(revoked.status, 401);
    assert.match(revoked.headers.get('WWW-Authenticate'), /Bearer .*error="invalid_token"/);
    assert.ok(
      revoked.headers
        .get('WWW-Authenticate')
        .includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`),
    );
    const refresh = await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refresh_token,
        client_id: credentials.clientId,
        resource: `${ORIGIN}/mcp`,
      }).toString(),
    });
    assert.equal(refresh.status, 400);
    assert.equal((await refresh.json()).error, 'invalid_grant');
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: public rate limit fails closed', async () => {
  const worker = start({ rateLimit: 1 });
  try {
    const post = poster(worker);
    assert.equal((await post('/api/not-found', {})).status, 404);
    const second = await post('/api/not-found', {});
    assert.equal(second.status, 429);
    assert.equal(second.headers.get('Retry-After'), '60');
  } finally {
    await worker.dispose();
  }
});

test(
  'real workerd: a second PC and forged cookie cannot cross device approval boundaries',
  { timeout: 20_000 },
  async () => {
    const worker = start();
    let desktop;
    let other;
    try {
      desktop = await connectDesktop(worker);
      other = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const cookie = phone.cookie.replace(desktop.deviceId, other.deviceId);
      assert.equal(
        (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: cookie } }))
          .status,
        401,
      );
      const invalid = await phone.post('/api/client/command', {
        name: 'get_workspace',
        args: { path: 'synthetic-private-path' },
      });
      assert.equal(invalid.status, 400);
      assert.equal(
        other.inbox.queue.some((value) => value.type === 'command'),
        false,
      );
      assert.equal(
        desktop.inbox.queue.some((value) => value.type === 'command'),
        false,
      );
      desktop.socket.close();
      const offline = await phone.post('/api/client/command', { name: 'get_workspace', args: {} });
      assert.equal(offline.status, 503);
      assert.equal((await offline.json()).error.code, 'unavailable');
    } finally {
      closeSocket(desktop?.socket);
      closeSocket(other?.socket);
      await worker.dispose();
    }
  },
);

test('real workerd: hibernation restores owner attachments and saved PC approvals', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    await worker.unsafeEvictDurableObject('kerfdesk-phone-control', 'RemoteDevice', {
      name: desktop.deviceId,
      webSockets: 'hibernate',
    });
    const requestId = randomUUID();
    desktop.send({ type: 'clients.list', requestId });
    const list = await desktop.inbox.next('clients', (value) => value.requestId === requestId);
    assert.equal(list.clients[0].id, phone.clientId);
    const pending = phone.post('/api/client/command', { name: 'get_workspace', args: {} });
    const command = await desktop.inbox.next('command');
    desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
    assert.equal((await pending).status, 200);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: five-minute pair expiry and fixed eight-hour phone expiry use server time', async () => {
  const worker = start({ clock: true });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const first = await offer(desktop);
    await poster(worker)('/__audit_clock', { deviceId: desktop.deviceId, offset: 301_000 });
    assert.equal(
      (
        await desktop.post(
          '/api/pair/claim',
          {
            v: 1,
            deviceId: desktop.deviceId,
            code: first.code,
            clientLabel: 'Expired phone',
            requestedScopes: ['read'],
          },
          { Origin: ORIGIN },
        )
      ).status,
      403,
    );
    const phone = await pairPhone(worker, desktop);
    await poster(worker)('/__audit_clock', {
      deviceId: desktop.deviceId,
      offset: 301_000 + 8 * 60 * 60 * 1000 + 1,
    });
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: phone.cookie } }))
        .status,
      401,
    );
    assert.equal(
      (await phone.post('/api/client/command', { name: 'get_workspace', args: {} })).status,
      401,
    );
    desktop.send({ type: 'clients.list', requestId: randomUUID() });
    assert.equal((await desktop.inbox.next('clients')).clients.length, 0);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test(
  'real workerd: 21 expired phone approvals cannot exhaust pairing; full client metadata stays under 4 KiB',
  { timeout: 30_000 },
  async () => {
    const worker = start({ clock: true });
    let desktop;
    try {
      desktop = await connectDesktop(worker);
      for (let i = 0; i < 21; i++) {
        await pairPhone(worker, desktop, ['read']);
        await poster(worker)('/__audit_clock', {
          deviceId: desktop.deviceId,
          offset: (i + 1) * (8 * 60 * 60 * 1000 + 1000),
        });
      }
      for (let i = 0; i < 20; i++)
        await pairPhone(worker, desktop, ['read', 'edit'], ['read', 'edit'], 'x'.repeat(64));
      const requestId = randomUUID();
      desktop.send({ type: 'clients.list', requestId });
      const list = await desktop.inbox.next('clients', (value) => value.requestId === requestId);
      assert.equal(list.clients.length, 20);
      assert.ok(Buffer.byteLength(JSON.stringify(list)) <= 4096);
      const blocked = await offer(desktop);
      assert.equal(
        (
          await desktop.post(
            '/api/pair/claim',
            {
              v: 1,
              deviceId: desktop.deviceId,
              code: blocked.code,
              clientLabel: 'Twenty-first active phone',
              requestedScopes: ['read'],
            },
            { Origin: ORIGIN },
          )
        ).status,
        403,
      );
      desktop.send({ type: 'clients.revokeAll', requestId: randomUUID() });
      await desktop.inbox.next('clients.revoked');
      assert.equal((await pairPhone(worker, desktop, ['read'])).session.status, 'approved');
    } finally {
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test('real workerd: an MCP grant outlives the phone session, expires at 30 days, and access-only consent has no refresh token', async () => {
  const worker = start({ clock: true });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const accessOnly = await authorizeMcp(worker, phone, 'kerfdesk:read');
    assert.equal(accessOnly.refresh_token, undefined);
    const credentials = await authorizeMcp(worker, phone);
    await poster(worker)('/__audit_clock', {
      deviceId: desktop.deviceId,
      offset: 9 * 60 * 60 * 1000,
    });
    assert.equal(
      (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: phone.cookie } }))
        .status,
      401,
    );
    const refreshForm = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh_token,
      client_id: credentials.clientId,
      resource: `${ORIGIN}/mcp`,
    });
    const refreshed = await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshForm.toString(),
    });
    assert.equal(refreshed.status, 200);
    const current = await refreshed.json();
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/mcp`, {
          headers: { Authorization: `Bearer ${current.access_token}` },
        })
      ).status,
      405,
    );
    const requestId = randomUUID();
    desktop.send({ type: 'clients.list', requestId });
    assert.equal(
      (await desktop.inbox.next('clients', (value) => value.requestId === requestId)).clients[0].id,
      phone.clientId,
    );
    await poster(worker)('/__audit_clock', {
      deviceId: desktop.deviceId,
      offset: 31 * 24 * 60 * 60 * 1000,
    });
    refreshForm.set('refresh_token', current.refresh_token);
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: refreshForm.toString(),
        })
      ).status,
      400,
    );
    const finalRequest = randomUUID();
    desktop.send({ type: 'clients.list', requestId: finalRequest });
    assert.equal(
      (await desktop.inbox.next('clients', (value) => value.requestId === finalRequest)).clients
        .length,
      0,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: MCP discovery is canonical; PKCE downgrades, wrong audience and private CIMD are rejected', async () => {
  const worker = start();
  let desktop;
  try {
    const discovery = await (
      await worker.dispatchFetch(`${ORIGIN}/.well-known/oauth-authorization-server`)
    ).json();
    assert.equal(discovery.issuer, ORIGIN);
    assert.ok(discovery.code_challenge_methods_supported.includes('S256'));
    const resource = await (
      await worker.dispatchFetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    assert.equal(resource.resource, `${ORIGIN}/mcp`);
    assert.deepEqual(resource.authorization_servers, [ORIGIN]);
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    await authorizeMcp(worker, phone, 'kerfdesk:read kerfdesk:edit offline_access', {
      async beforeConsent(url) {
        url.searchParams.set('code_challenge_method', 'plain');
        const response = await worker.dispatchFetch(url, { headers: { Cookie: phone.cookie } });
        assert.equal(response.status, 503);
        assert.equal((await response.text()).includes('name="handle"'), false);
      },
      async beforeToken(form) {
        const wrongResource = new URLSearchParams(form);
        wrongResource.set('resource', 'https://foreign.example/mcp');
        const response = await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: wrongResource.toString(),
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'invalid_target');
        const wrongVerifier = new URLSearchParams(form);
        wrongVerifier.set('code_verifier', 'x'.repeat(43));
        const verifierResponse = await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: wrongVerifier.toString(),
        });
        assert.equal(verifierResponse.status, 400);
        assert.equal((await verifierResponse.json()).error, 'invalid_grant');
      },
    });
    const privateQuery = new URLSearchParams({
      client_id: 'https://127.0.0.1/metadata.json',
      redirect_uri: 'https://audit-client.example/callback',
      response_type: 'code',
      scope: 'kerfdesk:read',
      resource: `${ORIGIN}/mcp`,
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
    });
    const rejected = await worker.dispatchFetch(`${ORIGIN}/authorize?${privateQuery}`, {
      headers: { Cookie: phone.cookie },
    });
    assert.equal(rejected.status, 503);
    assert.equal((await rejected.text()).includes('127.0.0.1'), false);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: OAuth access expires after 30 minutes and refresh rotation respects revocation', async () => {
  const worker = start({ clock: true });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const credentials = await authorizeMcp(worker, phone);
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/mcp`, {
          headers: { Authorization: `Bearer ${credentials.access_token}` },
        })
      ).status,
      405,
    );
    await poster(worker)('/__audit_clock', { deviceId: desktop.deviceId, offset: 31 * 60 * 1000 });
    assert.equal(
      (
        await worker.dispatchFetch(`${ORIGIN}/mcp`, {
          headers: { Authorization: `Bearer ${credentials.access_token}` },
        })
      ).status,
      401,
    );
    const refreshForm = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh_token,
      client_id: credentials.clientId,
      resource: `${ORIGIN}/mcp`,
    });
    const sendRefresh = (form) =>
      worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    const refreshed = await sendRefresh(refreshForm);
    assert.equal(refreshed.status, 200);
    const renewed = await refreshed.json();
    assert.notEqual(renewed.refresh_token, credentials.refresh_token);
    // The maintained provider accepts one previous token for retries. Using the new
    // current token advances that window; an older predecessor must then fail.
    const nextForm = new URLSearchParams(refreshForm);
    nextForm.set('refresh_token', renewed.refresh_token);
    const advanced = await sendRefresh(nextForm);
    assert.equal(advanced.status, 200);
    const current = await advanced.json();
    assert.equal((await sendRefresh(refreshForm)).status, 400);
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    await desktop.inbox.next('clients', (value) => !value.clients.length);
    const revoked = await worker.dispatchFetch(`${ORIGIN}/mcp`, {
      headers: { Authorization: `Bearer ${current.access_token}` },
    });
    assert.equal(revoked.status, 401);
    assert.match(revoked.headers.get('WWW-Authenticate'), /Bearer .*error="invalid_token"/);
    assert.ok(
      revoked.headers
        .get('WWW-Authenticate')
        .includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`),
    );
    refreshForm.set('refresh_token', current.refresh_token);
    assert.equal((await sendRefresh(refreshForm)).status, 400);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: a read-only MCP token receives an edit scope challenge before touching the PC', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read');
    const response = await worker.dispatchFetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'add_rectangle',
          arguments: {
            expectedRevision: 'audit-1',
            requestId: randomUUID(),
            xMm: 0,
            yMm: 0,
            widthMm: 10,
            heightMm: 10,
          },
        },
      }),
    });
    assert.equal(response.status, 403);
    assert.match(
      response.headers.get('WWW-Authenticate'),
      /insufficient_scope.*kerfdesk:read kerfdesk:edit/,
    );
    assert.match(
      response.headers.get('WWW-Authenticate'),
      /error_description="Editing requires approval on this computer\."/,
    );
    assert.equal(
      desktop.inbox.queue.some((value) => value.type === 'command'),
      false,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('real workerd: desktop error text is redacted; invalid result and oversized WebSocket cannot leak data', async () => {
  const worker = start();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop);
    for (const responseType of ['error', 'invalid', 'oversized']) {
      const pending = phone.post('/api/client/command', { name: 'get_workspace', args: {} });
      const command = await desktop.inbox.next('command');
      if (responseType === 'error')
        desktop.send({
          type: 'error',
          requestId: command.requestId,
          error: {
            code: 'failed',
            message: 'synthetic-private-error-path',
            stack: 'synthetic-private-stack',
          },
        });
      else if (responseType === 'invalid')
        desktop.send({
          type: 'result',
          requestId: command.requestId,
          result: { syntheticPrivateValue: 'synthetic-private-marker' },
        });
      else desktop.socket.send('x'.repeat(256 * 1024 + 1));
      const response = await pending;
      assert.equal(response.status, 400);
      const body = await response.text();
      assert.equal(JSON.parse(body).error.code, 'failed');
      assert.equal(body.includes('synthetic-private'), false);
    }
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test(
  'real workerd: an unanswered command times out after 20 seconds and cancels the desktop request',
  { timeout: 28_000 },
  async () => {
    const worker = start();
    let desktop;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const startTime = performance.now();
      const pending = phone.post('/api/client/command', { name: 'get_workspace', args: {} });
      const command = await desktop.inbox.next('command');
      const response = await pending;
      assert.ok(performance.now() - startTime >= 19_500);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'unavailable');
      assert.equal((await desktop.inbox.next('cancel')).requestId, command.requestId);
      desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
    } finally {
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test(
  'real workerd: modern SDK cancellation aborts the relay and sends cancellation to the desktop',
  { timeout: 15_000 },
  async () => {
    const worker = start({
      observeAbort: true,
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
      const wireSignals = [];
      client = new Client(
        { name: 'synthetic-cancellation-audit', version: '1' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
        fetch: (url, init = {}) => {
          const headers = new Headers(init.headers);
          headers.set('Authorization', `Bearer ${credentials.access_token}`);
          wireSignals.push(init.signal);
          return fetch(url, { ...init, headers });
        },
      });
      await client.connect(transport);
      const abort = new AbortController();
      const call = client.callTool(
        { name: 'get_workspace', arguments: {} },
        { signal: abort.signal },
      );
      const rejection = assert.rejects(
        call,
        (error) =>
          error.name === 'AbortError' ||
          (error.name === 'SdkError' && error.message.includes('AbortError')),
      );
      const command = await desktop.inbox.next('command');
      abort.abort();
      await rejection;
      assert.ok(
        wireSignals.some((signal) => signal?.aborted),
        'SDK must abort the actual HTTP request, not only its result promise.',
      );
      let cancellation;
      try {
        cancellation = await desktop.inbox.next('cancel');
      } catch {
        const observation = await (await worker.dispatchFetch(`${ORIGIN}/__audit_observe`)).json();
        throw new Error(
          `Desktop cancellation absent. Local ingress signal observation: ${JSON.stringify(observation)}.`,
        );
      }
      assert.equal(cancellation.requestId, command.requestId);
      desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
    } finally {
      await client?.close();
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);
