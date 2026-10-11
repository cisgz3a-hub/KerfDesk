import { KerfDeskMcpError, mcpErrorMessages } from '../../../electron/mcp/backend.js';
import {
  PUBLIC_ORIGIN,
  COOKIE_NAME,
  MAX_METADATA_BYTES,
  registerSchema,
  claimSchema,
  parseCommand,
  mcpCommandScope,
  uuid,
  secret,
  type GrantProps,
} from './protocol.js';
import {
  RequestFailure,
  bodyJson,
  digest,
  json,
  controlCookie,
  csrfAllowed,
  csrfToken,
  originAllowed,
  randomSecret,
  remainingPairingMs,
  removeCookie,
  sessionIdentity,
} from './security.js';
import { device, approvedSession, relayRequest } from './relay.js';
import { authorizePage, type AppEnv } from './oauth.js';
import { clientLimited, priorityCommand, rateLimited } from './limits.js';
import { pushSubscriptionSchema, vapidConfig } from './push.js';
import { APP_ASSETS, appAssetPath } from './app-assets.js';
async function registerOwner(request: Request, env: Env) {
  const parsed = registerSchema.safeParse(await bodyJson(request, MAX_METADATA_BYTES));
  if (!parsed.success) throw new RequestFailure(400);
  const ok = await device(env, parsed.data.deviceId).register(
    await digest(parsed.data.ownerSecret),
    parsed.data.label,
  );
  return json({ registered: ok }, ok ? 200 : 401);
}
async function connectOwner(request: Request, env: Env, url: URL) {
  const id = uuid.safeParse(url.searchParams.get('deviceId'));
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!id.success || !bearer || !secret.safeParse(bearer).success) throw new RequestFailure(401);
  return device(env, id.data).fetch(
    new Request('https://private-device.invalid/owner', {
      headers: {
        Upgrade: 'websocket',
        'X-Device-Id': id.data,
        'X-Owner-Digest': await digest(bearer),
      },
    }),
  );
}
async function claimPairing(request: Request, env: Env) {
  if (!originAllowed(request, PUBLIC_ORIGIN, true)) throw new RequestFailure(403);
  const parsed = claimSchema.safeParse(await bodyJson(request, MAX_METADATA_BYTES));
  if (!parsed.success) throw new RequestFailure(400);
  const token = randomSecret();
  const result = await device(env, parsed.data.deviceId).claim(
    parsed.data.code,
    parsed.data.clientLabel,
    parsed.data.requestedScopes,
    await digest(token),
  );
  if (!result) throw new RequestFailure(403);
  const expiresInMs = remainingPairingMs(result.expiresAt);
  if (expiresInMs === 0) throw new RequestFailure(403);
  return json({ status: 'pending', expiresAt: result.expiresAt, expiresInMs }, 202, {
    'Set-Cookie': controlCookie(parsed.data.deviceId, result.clientId, token, 300),
  });
}
async function sessionStatus(request: Request, env: Env) {
  const identity = await sessionIdentity(request);
  if (!identity) return json({ status: 'unavailable', online: false }, 401);
  const info = await device(env, identity.deviceId).session(identity.clientId, identity.digest);
  if (info.status !== 'approved') return json(info, info.status === 'pending' ? 200 : 401);
  const cookie = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const token = cookie?.slice(COOKIE_NAME.length + 1).split('.')[2];
  if (!token) throw new RequestFailure(401);
  return json(
    {
      status: 'approved',
      online: info.online,
      deviceLabel: info.deviceLabel,
      client: info.client,
      csrf: await csrfToken(identity),
    },
    200,
    {
      // The durable expiry is fixed at approval; repeated status checks never renew the session.
      'Set-Cookie': controlCookie(
        identity.deviceId,
        identity.clientId,
        token,
        Math.max(0, Math.floor((info.sessionExpiresAt - Date.now()) / 1000)),
      ),
    },
  );
}
type PhoneSession = NonNullable<Awaited<ReturnType<typeof approvedSession>>>;
/** ADR-583: one push subscription per approved phone; null removes it. */
async function clientPush(request: Request, env: Env, session: PhoneSession): Promise<Response> {
  const body = await bodyJson(request);
  const value = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const subscription =
    value.subscription === null ? null : pushSubscriptionSchema.safeParse(value.subscription);
  if (Object.keys(value).length !== 1 || (subscription !== null && !subscription.success))
    throw new RequestFailure(400);
  if (vapidConfig(env) === null) throw new RequestFailure(404);
  const saved = await device(env, session.identity.deviceId).savePush(
    session.identity.clientId,
    session.identity.digest,
    subscription === null ? null : subscription.data,
  );
  return json({ saved }, saved ? 200 : 409);
}
async function clientRevoke(env: Env, session: PhoneSession): Promise<Response> {
  await device(env, session.identity.deviceId).revokeSession(
    session.identity.clientId,
    session.identity.digest,
  );
  return json({ revoked: true }, 200, { 'Set-Cookie': removeCookie() });
}
async function clientRequest(request: Request, env: Env, url: URL, ctx: ExecutionContext) {
  const session = await approvedSession(request, env);
  if (!session) throw new RequestFailure(401);
  if (!(await csrfAllowed(request, session.identity, PUBLIC_ORIGIN))) throw new RequestFailure(403);
  if (url.pathname === '/api/client/revoke') return clientRevoke(env, session);
  if (url.pathname === '/api/client/push') return clientPush(request, env, session);
  const body = await bodyJson(request);
  const command = parseCommand(body);
  if (!command) throw new RequestFailure(400);
  const props: GrantProps = {
    deviceId: session.identity.deviceId,
    clientId: session.identity.clientId,
    leaseId: session.info.leaseId,
  };
  if (
    session.info.client.scopes.includes(mcpCommandScope(command.name)) &&
    (await clientLimited(env, props, priorityCommand(body)))
  )
    return rateLimited();
  try {
    return json({
      result: await relayRequest(
        env,
        props,
        session.info.client.scopes,
        command.name,
        command.args,
        request.signal,
        session.identity.digest,
        ctx,
      ),
    });
  } catch (error) {
    const code = error instanceof KerfDeskMcpError ? error.code : 'failed';
    return json(
      { error: { code, message: mcpErrorMessages[code] } },
      code === 'unavailable' ? 503 : 400,
    );
  }
}
/** Live phone socket (ADR-582): same cookie session, exact Origin, checked again in the DO. */
async function clientSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new RequestFailure(426);
  if (!originAllowed(request, PUBLIC_ORIGIN, true)) throw new RequestFailure(403);
  const session = await approvedSession(request, env);
  if (!session) throw new RequestFailure(401);
  return device(env, session.identity.deviceId).fetch(
    new Request('https://private-device.invalid/client', {
      headers: {
        Upgrade: 'websocket',
        'X-Client-Id': session.identity.clientId,
        'X-Session-Digest': session.identity.digest,
      },
    }),
  );
}
function pushKey(env: Env): Response {
  const config = vapidConfig(env);
  return config === null
    ? json({ error: 'not_found' }, 404)
    : json({ publicKey: config.publicKey });
}
function staticAsset(request: Request, env: Env, url: URL): Promise<Response> | Response {
  if (url.pathname === '/health') return json({ service: 'KerfDesk phone control', protocol: 2 });
  if (url.pathname === '/app')
    return new Response(null, { status: 302, headers: { Location: '/app/' } });
  if (APP_ASSETS.has(url.pathname)) {
    const target = new URL(appAssetPath(url.pathname), url);
    return env.ASSETS.fetch(new Request(target, request));
  }
  if (
    ![
      '/',
      '/control',
      '/control.js',
      '/control-actions.js',
      '/control-edit.js',
      '/control-model.js',
      '/control-workspace.js',
      '/control-live.js',
      '/control-drafts.js',
      '/control-pairing.js',
      '/control-scanner.js',
      '/control-scanner-link.js',
      '/control-scanner-reader.js',
      '/control-scanner-camera.js',
      '/control-scanner-decoder.js',
      '/control-scanner.css',
      '/control-touch.js',
      '/control-touch-geometry.js',
      '/control-touch-view.js',
      '/control-touch-viewport.js',
      '/control-touch.css',
      '/control-machine.js',
      '/control-machine-view.js',
      '/pairing.js',
      '/control.css',
      '/third-party-notices.txt',
    ].includes(url.pathname)
  )
    return json({ error: 'not_found' }, 404);
  const target = new URL(url);
  if (target.pathname === '/' || target.pathname === '/control') target.pathname = '/control.html';
  target.search = '';
  return env.ASSETS.fetch(new Request(target, request));
}
type Route = (
  request: Request,
  env: AppEnv,
  url: URL,
  ctx: ExecutionContext,
) => Promise<Response> | Response;
const ROUTES: Record<string, Route> = {
  'POST /api/desktop/register': (request, env) => registerOwner(request, env),
  'GET /api/desktop/connect': (request, env, url) => connectOwner(request, env, url),
  'POST /api/pair/claim': (request, env) => claimPairing(request, env),
  'GET /api/session': (request, env) => sessionStatus(request, env),
  'GET /api/pair/status': (request, env) => sessionStatus(request, env),
  'GET /api/client/socket': (request, env) => clientSocket(request, env),
  'GET /api/push/key': (_request, env) => pushKey(env),
  'POST /api/client/command': clientRequest,
  'POST /api/client/revoke': clientRequest,
  'POST /api/client/push': clientRequest,
};
export const publicHandler: ExportedHandler<AppEnv> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return authorizePage(request, env);
    const route = ROUTES[`${request.method} ${url.pathname}`];
    if (route !== undefined) return route(request, env, url, ctx);
    return request.method === 'GET'
      ? staticAsset(request, env, url)
      : json({ error: 'not_found' }, 404);
  },
};
