import { parseCommand, type GrantProps } from './protocol.js';
import { digest, json } from './security.js';

export const rateLimited = () => json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });

/** Classification reserves bounded verification capacity; it never grants authority. */
export async function abortRequest(request: Request, path: string): Promise<boolean> {
  if (request.method !== 'POST' || !['/api/client/command', '/mcp'].includes(path)) return false;
  try {
    const body: unknown = await request.clone().json();
    if (path === '/api/client/command') return parseCommand(body)?.name === 'abort_job';
    // The installed SDK also accepts legacy batches, bounded to 100 messages.
    // Only an entirely valid Abort batch may spend the reserved lane.
    const messages = Array.isArray(body) ? body : [body];
    return messages.length > 0 && messages.length <= 100 && messages.every(abortToolMessage);
  } catch {
    return false;
  }
}
function abortToolMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
  const value = message as Record<string, unknown>,
    params = value['params'];
  if (value['jsonrpc'] !== '2.0' || value['method'] !== 'tools/call' || !wireId(value['id']))
    return false;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false;
  const call = params as Record<string, unknown>;
  return parseCommand({ name: call['name'], args: call['arguments'] })?.name === 'abort_job';
}
function wireId(id: unknown): boolean {
  return (typeof id === 'string' && id.length <= 512) || Number.isSafeInteger(id);
}

export async function ingressLimited(request: Request, env: Env, url: URL): Promise<boolean> {
  if (request.method === 'GET' && url.pathname !== '/api/desktop/connect') return false;
  const credentialRoute = ['/mcp', '/api/client/command', '/api/client/revoke'].includes(
    url.pathname,
  );
  const priority = credentialRoute && (await abortRequest(request, url.pathname));
  // Public pairing/registration cannot spend approved clients' verification allowance.
  // Ordinary credential attempts cannot spend the separate, bounded Abort lane.
  const lane = credentialRoute ? (priority ? 'credential-abort' : 'credential') : 'public';
  const key = await digest(
    `remote-v2:${lane}:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`,
  );
  return !(await (credentialRoute ? env.AUTH_LIMIT : env.PUBLIC_LIMIT).limit({ key })).success;
}

/** Call only after token/session, live approval, CSRF (phone) and required scope validation. */
export async function clientLimited(env: Env, props: GrantProps, abort: boolean): Promise<boolean> {
  // Key the authenticated PC approval, not IP or a rotating access-token value.
  const key = await digest(`remote-client-v1:${props.deviceId}:${props.clientId}:${props.leaseId}`);
  return !(await (abort ? env.ABORT_LIMIT : env.CLIENT_LIMIT).limit({ key })).success;
}
