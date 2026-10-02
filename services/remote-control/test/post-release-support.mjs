import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ORIGIN, cookieValue, poster, start } from './support.mjs';

/** Local-only binding fault witness. No fault switch or extra route enters production source. */
export function startKvFaultWorker() {
  const source = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  const matches = [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*_default) as default/g)];
  assert.equal(matches.length, 1, 'The witness must wrap the actual built Worker default.');
  const wrapped =
    source.replace(matches[0][0], 'postReleaseKvWitness as default') +
    `
let postReleaseKvFault = null;
const postReleaseKvWitness = { async fetch(request, env, ctx) {
  if (new URL(request.url).pathname === '/__audit_kv_fault') {
    const { mode } = await request.json();
    if (![null, 'get', 'put', 'delete'].includes(mode)) throw new Error('Invalid local witness mode');
    postReleaseKvFault = mode;
    return Response.json({ changed: true });
  }
  const actual = env.OAUTH_KV;
  const fail = (operation, key) => {
    if (operation === postReleaseKvFault && key.startsWith('kerfdesk:consent-binding:v1:'))
      throw new Error('Synthetic consent binding outage');
  };
  const OAUTH_KV = {
    get(key, ...args) { fail('get', key); return actual.get(key, ...args); },
    getWithMetadata(key, ...args) { fail('get', key); return actual.getWithMetadata(key, ...args); },
    put(key, ...args) { fail('put', key); return actual.put(key, ...args); },
    delete(key) { fail('delete', key); return actual.delete(key); },
    list(...args) { return actual.list(...args); }
  };
  return ${matches[0][1]}.fetch(request, { ...env, OAUTH_KV }, ctx);
} };
`;
  return start({ extra: { scriptPath: undefined, script: wrapped } });
}

export function closeSocket(socket) {
  if (socket && socket.readyState < 2) socket.close();
}

/** Keep consent and token exchange separate so tests can change PC approval between them. */
export async function prepareConsent(worker, phone, options = {}) {
  const redirectUri = 'https://post-release-audit.example/callback';
  const registration = await poster(worker)('/oauth/register', {
    client_name: 'Post-release boundary audit',
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  const verifier = randomBytes(32).toString('base64url');
  const requestedScope = options.scope ?? 'kerfdesk:read kerfdesk:edit offline_access';
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: requestedScope,
    resource: `${ORIGIN}/mcp`,
    state: randomUUID(),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  const page = await worker.dispatchFetch(`${ORIGIN}/authorize?${query}`, {
    headers: { Cookie: phone.cookie },
  });
  assert.equal(page.status, 200);
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  assert.ok(handle, 'An approved phone must receive the consent form.');
  const oauthCookie = cookieValue(page);
  assert.ok(oauthCookie, 'Consent must be bound to its OAuth browser cookie.');
  const submit = (
    decision,
    controlCookie,
    scopes,
    extraFields = [],
    browserCookie = oauthCookie,
  ) => {
    const form = new URLSearchParams({ handle, decision });
    for (const scope of scopes) form.append('scope', scope);
    for (const [name, value] of extraFields) form.append(name, value);
    return worker.dispatchFetch(`${ORIGIN}/authorize`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: [controlCookie, browserCookie].join('; '),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  };
  return {
    html,
    handle,
    oauthCookie,
    clientId: client.client_id,
    approve(controlCookie = phone.cookie, scopes = requestedScope.split(' '), extraFields = []) {
      return submit('allow', controlCookie, scopes, extraFields);
    },
    decline: () => submit('deny', phone.cookie, requestedScope.split(' ')),
    submit,
    tokenForm(approval) {
      assert.equal(approval.status, 303);
      const callback = new URL(approval.headers.get('Location'));
      assert.equal(callback.origin, new URL(redirectUri).origin);
      assert.ok(callback.searchParams.get('code'));
      return new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code: callback.searchParams.get('code'),
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      });
    },
  };
}

export function redeem(worker, form) {
  return worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

export function mcpPost(worker, credentials, message) {
  return worker.dispatchFetch(`${ORIGIN}/mcp`, {
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

export const editArguments = () => ({
  expectedRevision: 'audit-1',
  requestId: randomUUID(),
  xMm: 10,
  yMm: 10,
  widthMm: 20,
  heightMm: 20,
});

export const toolCall = (id, name, args = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});
