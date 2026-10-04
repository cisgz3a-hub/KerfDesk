import { KerfDeskMcpError, mcpErrorMessages } from '../../../electron/mcp/backend.js';
import {
  PUBLIC_ORIGIN,
  COOKIE_NAME,
  MAX_METADATA_BYTES,
  registerSchema,
  claimSchema,
  parseCommand,
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
async function clientRequest(request: Request, env: Env, url: URL, ctx: ExecutionContext) {
  const session = await approvedSession(request, env);
  if (!session) throw new RequestFailure(401);
  if (!(await csrfAllowed(request, session.identity, PUBLIC_ORIGIN))) throw new RequestFailure(403);
  if (url.pathname === '/api/client/revoke') {
    await device(env, session.identity.deviceId).revokeSession(
      session.identity.clientId,
      session.identity.digest,
    );
    return json({ revoked: true }, 200, { 'Set-Cookie': removeCookie() });
  }
  const command = parseCommand(await bodyJson(request));
  if (!command) throw new RequestFailure(400);
  const props: GrantProps = {
    deviceId: session.identity.deviceId,
    clientId: session.identity.clientId,
    leaseId: session.info.leaseId,
  };
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
function staticAsset(request: Request, env: Env, url: URL): Promise<Response> | Response {
  if (url.pathname === '/health') return json({ service: 'KerfDesk phone control', protocol: 1 });
  if (
    ![
      '/',
      '/control',
      '/control.js',
      '/control-edit.js',
      '/control-model.js',
      '/control-workspace.js',
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
export const publicHandler: ExportedHandler<AppEnv> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return authorizePage(request, env);
    const route = request.method + ' ' + url.pathname;
    switch (route) {
      case 'POST /api/desktop/register':
        return registerOwner(request, env);
      case 'GET /api/desktop/connect':
        return connectOwner(request, env, url);
      case 'POST /api/pair/claim':
        return claimPairing(request, env);
      case 'GET /api/session':
      case 'GET /api/pair/status':
        return sessionStatus(request, env);
      case 'POST /api/client/command':
      case 'POST /api/client/revoke':
        return clientRequest(request, env, url, ctx);
      default:
        return request.method === 'GET'
          ? staticAsset(request, env, url)
          : json({ error: 'not_found' }, 404);
    }
  },
};
