import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';

export const ORIGIN = 'https://kerfdesk-phone-control.cisgz3a.workers.dev';
let address = 1;
export function start(options = {}) {
  const scriptPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const source = options.clock
    ? clockWitness(readFileSync(scriptPath, 'utf8'))
    : options.observeAbort
      ? abortWitness(readFileSync(scriptPath, 'utf8'))
      : null;
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      name: 'kerfdesk-phone-control',
      modules: true,
      ...(source ? { script: source } : { scriptPath }),
      // Match pinned workerd capability, with production-date qualification explicitly separate.
      compatibilityDate: '2026-09-30',
      compatibilityFlags: ['global_fetch_strictly_public', 'enable_request_signal'],
      cf: false,
      bindings: { PUBLIC_ORIGIN: ORIGIN },
      kvNamespaces: ['OAUTH_KV'],
      durableObjects: {
        REMOTE_DEVICES: {
          className: options.clock ? 'AuditClockDevice' : 'RemoteDevice',
          useSQLite: true,
        },
      },
      ratelimits: {
        PUBLIC_LIMIT: {
          namespace_id: '2001',
          simple: { limit: options.rateLimit ?? 1000, period: 60 },
        },
      },
      assets: {
        directory: fileURLToPath(new URL('../public', import.meta.url)),
        binding: 'ASSETS',
        routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
        assetConfig: { html_handling: 'none' },
      },
      handleStructuredLogs: options.handleStructuredLogs,
      ...options.extra,
    }),
  );
  const dispatch = worker.dispatchFetch.bind(worker);
  worker.dispatchFetch = (url, init = {}) => dispatch(url, { redirect: 'manual', ...init });
  return worker;
}

function abortWitness(source) {
  const match = [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*_default) as default/g)];
  if (match.length !== 1 || source.includes('__audit_observe'))
    throw new Error('Unexpected bundle export for local abort observer.');
  const original = match[0][1];
  return (
    source.replace(match[0][0], 'auditObserver as default') +
    `\n
let auditAborts = 0; let auditRequests = 0; const auditResponses = [];
const auditObserver = { async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/__audit_observe') return Response.json({ aborted: auditAborts, requests: auditRequests, responses: auditResponses });
  if (url.pathname === '/mcp') { auditRequests++; request.signal.addEventListener('abort', () => { auditAborts++; }); }
  const response = await ${original}.fetch(request, env, ctx);
  if (url.pathname === '/mcp') auditResponses.push(response.headers.get('Content-Type'));
  return response;
} };\n`
  );
}

/** A local-only clock witness. No debug route or controllable clock enters the production bundle. */
function clockWitness(source) {
  const match = [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*_default) as default/g)];
  if (match.length !== 1 || source.includes('__audit_clock'))
    throw new Error('Unexpected bundle export for isolated clock witness.');
  const original = match[0][1];
  return (
    `let auditOffset = 0; const actualDateNow = Date.now.bind(Date); Date.now = () => actualDateNow() + auditOffset;\n` +
    source.replace(match[0][0], 'auditDefault as default') +
    `\n
class AuditClockDevice extends RemoteDevice { async advanceAuditClock(offset) { auditOffset = offset; } }
const auditDefault = { async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/__audit_clock') {
    const data = await request.json();
    if (!Number.isSafeInteger(data.offset) || data.offset < 0 || data.offset > 40 * 86400000) throw new Error('Invalid witness time');
    auditOffset = data.offset;
    await env.REMOTE_DEVICES.get(env.REMOTE_DEVICES.idFromName(data.deviceId)).advanceAuditClock(data.offset);
    return Response.json({ changed: true });
  }
  return ${original}.fetch(request, env, ctx);
} };
export { AuditClockDevice };\n`
  );
}
export function poster(worker, extraHeaders = {}) {
  const ip = `192.0.2.${(address++ % 250) + 1}`;
  return (path, body, headers = {}) =>
    worker.dispatchFetch(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
        ...extraHeaders,
        ...headers,
      },
      body: JSON.stringify(body),
    });
}

/** Direct real-workerd HTTP ingress; the Miniflare dev proxy does not forward client cancellation. */
export async function directFetcher(worker) {
  const direct = await worker.unsafeGetDirectURL('kerfdesk-phone-control');
  return (url, init = {}) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      if (target.origin !== ORIGIN) {
        reject(new Error('Synthetic direct ingress only accepts the fixed relay origin.'));
        return;
      }
      const headers = new Headers(init.headers);
      headers.set('Host', target.host);
      const request = httpRequest(
        {
          hostname: direct.hostname,
          port: direct.port,
          path: target.href,
          method: init.method ?? 'GET',
          headers: Object.fromEntries(headers),
          signal: init.signal,
        },
        (response) => {
          const resultHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const item of value) resultHeaders.append(key, item);
            else if (value !== undefined) resultHeaders.set(key, value);
          }
          resolve(
            new Response(response.statusCode === 204 ? null : Readable.toWeb(response), {
              status: response.statusCode,
              headers: resultHeaders,
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(init.body);
    });
}
export function cookieValue(response) {
  return response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}
export function messages(socket) {
  const queue = [];
  const waiters = [];
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data);
    queue.push(value);
    for (const waiter of [...waiters]) {
      const index = queue.findIndex(waiter.match);
      if (index < 0) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(queue.splice(index, 1)[0]);
    }
  });
  return {
    queue,
    next(type, predicate = () => true) {
      const match = (value) => value.type === type && predicate(value);
      const index = queue.findIndex(match);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = {
          match,
          resolve,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error(`Expected ${type} message.`));
          }, 4000),
        };
        waiters.push(waiter);
      });
    },
  };
}
export async function connectDesktop(worker, identity = {}) {
  const deviceId = identity.deviceId ?? randomUUID();
  const ownerSecret = identity.ownerSecret ?? randomBytes(32).toString('base64url');
  const post = poster(worker);
  const response = await post('/api/desktop/register', {
    v: 1,
    deviceId,
    ownerSecret,
    label: 'Audit PC',
  });
  if (response.status !== 200) throw new Error('Synthetic registration failed.');
  const connected = await worker.dispatchFetch(
    `${ORIGIN}/api/desktop/connect?deviceId=${deviceId}`,
    {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${ownerSecret}` },
    },
  );
  if (connected.status !== 101 || !connected.webSocket)
    throw new Error('Synthetic desktop connection failed.');
  const socket = connected.webSocket;
  const inbox = messages(socket);
  socket.accept();
  await inbox.next('connected');
  await inbox.next('clients');
  const send = (message) => socket.send(JSON.stringify({ v: 1, ...message }));
  return { deviceId, ownerSecret, socket, inbox, send, post };
}
export async function offer(desktop) {
  const requestId = randomUUID();
  desktop.send({ type: 'pair.create', requestId });
  return desktop.inbox.next('pair.offer', (value) => value.requestId === requestId);
}
export async function pairPhone(
  worker,
  desktop,
  requestedScopes = ['read', 'edit'],
  approvedScopes = requestedScopes,
  clientLabel = 'Audit phone',
) {
  const pairing = await offer(desktop);
  const response = await desktop.post(
    '/api/pair/claim',
    { v: 1, deviceId: desktop.deviceId, code: pairing.code, clientLabel, requestedScopes },
    { Origin: ORIGIN },
  );
  if (response.status !== 202) throw new Error('Synthetic claim failed.');
  const cookie = cookieValue(response);
  const request = await desktop.inbox.next('pair.request');
  desktop.send({
    type: 'pair.decide',
    pairingId: request.pairingId,
    approved: true,
    scopes: approvedScopes,
  });
  await desktop.inbox.next('clients', (value) =>
    value.clients.some((client) => client.id === request.pairingId),
  );
  const sessionResponse = await worker.dispatchFetch(`${ORIGIN}/api/session`, {
    headers: { Cookie: cookie },
  });
  const session = await sessionResponse.json();
  if (session.status !== 'approved') throw new Error('Synthetic approval unavailable.');
  const post = poster(worker, { Origin: ORIGIN, Cookie: cookie, 'X-KerfDesk-CSRF': session.csrf });
  return { cookie, session, clientId: request.pairingId, post };
}
export const workspace = {
  revision: 'audit-1',
  mode: 'laser',
  name: 'Synthetic audit workspace',
  dirty: false,
  selection: [],
  artwork: [],
  operations: [],
  totalArtwork: 0,
  totalOperations: 0,
  truncated: false,
};
export async function authorizeMcp(
  worker,
  phone,
  requestedScope = 'kerfdesk:read kerfdesk:edit offline_access',
  options = {},
) {
  const register = await poster(worker)('/oauth/register', {
    client_name: 'Synthetic MCP audit',
    redirect_uris: ['https://audit-client.example/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  if (register.status !== 201) throw new Error(`Synthetic DCR failed (${register.status}).`);
  const client = await register.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: 'https://audit-client.example/callback',
    response_type: 'code',
    scope: requestedScope,
    resource: `${ORIGIN}/mcp`,
    state: randomUUID(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (options.beforeConsent) await options.beforeConsent(new URL(`${ORIGIN}/authorize?${query}`));
  const consent = await worker.dispatchFetch(`${ORIGIN}/authorize?${query}`, {
    headers: { Cookie: phone.cookie },
  });
  const consentText = await consent.text();
  const handle = consentText.match(/name="handle" value="([^"]+)"/)?.[1];
  if (!handle) throw new Error(`Synthetic consent absent (${consent.status}).`);
  const cookies = [phone.cookie, cookieValue(consent)].filter(Boolean).join('; ');
  const form = new URLSearchParams({ handle, decision: 'allow' });
  for (const scope of requestedScope.split(' ')) form.append('scope', scope);
  const approved = await worker.dispatchFetch(`${ORIGIN}/authorize`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Cookie: cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (approved.status !== 303) throw new Error(`Synthetic consent failed (${approved.status}).`);
  const redirect = new URL(approved.headers.get('Location'));
  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    redirect_uri: 'https://audit-client.example/callback',
    code: redirect.searchParams.get('code'),
    code_verifier: verifier,
    resource: `${ORIGIN}/mcp`,
  });
  if (options.beforeToken) await options.beforeToken(new URLSearchParams(tokenForm));
  const tokenResponse = await worker.dispatchFetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenForm.toString(),
  });
  if (tokenResponse.status !== 200)
    throw new Error(`Synthetic token failed (${tokenResponse.status}).`);
  return {
    ...(await tokenResponse.json()),
    clientId: client.client_id,
    cookie: cookies,
    handle,
    form: form.toString(),
    tokenForm: tokenForm.toString(),
  };
}
