import OAuthProvider, { GrantType, OAuthError } from '@cloudflare/workers-oauth-provider';
import {
  PUBLIC_ORIGIN,
  RESOURCE,
  ACCESS_TTL_SECONDS,
  GRANT_TTL_SECONDS,
  MAX_BYTES,
  MAX_METADATA_BYTES,
  OAUTH_READ,
  OAUTH_EDIT,
  OAUTH_CONTROL,
  oauthGrantSchema,
  oauthScopes,
} from './protocol.js';
import { RequestFailure, boundedText, json, originAllowed, safeResponse } from './security.js';
import { device } from './relay.js';
import { publicHandler } from './public.js';
import { protectedHandler } from './mcp.js';
import { ingressLimited, rateLimited } from './limits.js';
export { RemoteDevice } from './device.js';
const provider = new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler: protectedHandler,
  defaultHandler: publicHandler,
  authorizeEndpoint: `${PUBLIC_ORIGIN}/authorize`,
  tokenEndpoint: `${PUBLIC_ORIGIN}/oauth/token`,
  clientRegistrationEndpoint: `${PUBLIC_ORIGIN}/oauth/register`,
  resourceMetadata: {
    resource: RESOURCE,
    authorization_servers: [PUBLIC_ORIGIN],
    resource_name: 'KerfDesk desktop workspace',
    bearer_methods_supported: ['header'],
  },
  requiredScopes: [OAUTH_READ],
  scopesSupported: [OAUTH_READ, OAUTH_EDIT, OAUTH_CONTROL, 'offline_access'],
  accessTokenTTL: ACCESS_TTL_SECONDS,
  refreshTokenTTL: GRANT_TTL_SECONDS,
  clientRegistrationTTL: 90 * 24 * 60 * 60,
  clientIdMetadataDocumentEnabled: true,
  cookiePrefix: '__Host-kerfdesk_oauth-',
  async tokenExchangeCallback(options) {
    const props = oauthGrantSchema.safeParse(options.props);
    const scopes = oauthScopes(options.requestedScope);
    if (
      !props.success ||
      !scopes ||
      options.resource !== RESOURCE ||
      !(await device(options.env, props.data.deviceId).authorize(props.data, scopes))
    )
      throw new OAuthError('invalid_grant', {
        description: 'This computer approval is unavailable.',
      });
    const refreshTokenTTL = options.scope.includes('offline_access') ? GRANT_TTL_SECONDS : 0;
    if (
      options.grantType === GrantType.AUTHORIZATION_CODE &&
      !(await device(options.env, props.data.deviceId).retainGrant(
        props.data,
        scopes,
        refreshTokenTTL || ACCESS_TTL_SECONDS,
      ))
    )
      throw new OAuthError('invalid_grant', {
        description: 'This computer approval is unavailable.',
      });
    return { refreshTokenTTL };
  },
  onError(error) {
    // Do not emit library internals, client URLs, submitted values, tokens or identifiers.
    return json(
      { error: error.code, error_description: 'The authorization request is unavailable.' },
      error.status,
      error.headers,
    );
  },
});

function validateRequest(request: Request, env: Env): URL {
  const url = new URL(request.url);
  if (env.PUBLIC_ORIGIN !== PUBLIC_ORIGIN || url.origin !== PUBLIC_ORIGIN)
    throw new RequestFailure(403);
  if (!originAllowed(request, PUBLIC_ORIGIN, false)) throw new RequestFailure(403);
  if (
    url.searchParams.has('access_token') ||
    url.searchParams.has('ownerSecret') ||
    url.searchParams.has('token')
  )
    throw new RequestFailure(400);

  return url;
}
async function boundBody(request: Request, url: URL): Promise<Request> {
  // The library's JSON/form parsers are preceded by a real streamed size bound.
  if (request.body) {
    const maximum =
      url.pathname === '/mcp'
        ? MAX_BYTES
        : url.pathname === '/authorize'
          ? 16 * 1024
          : MAX_METADATA_BYTES;
    const body = await boundedText(request, maximum);
    request = new Request(request, { body, signal: request.signal });
  }

  return request;
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = validateRequest(request, env);
      request = await boundBody(request, url);
      if (await ingressLimited(request, env, url)) return safeResponse(rateLimited());
      const response = await provider.fetch(request, env, ctx);
      const camera =
        request.method === 'GET' &&
        (url.pathname === '/' || url.pathname === '/control') &&
        response.status === 200 &&
        response.headers.get('Content-Type')?.startsWith('text/html') === true;
      return safeResponse(response, camera);
    } catch (error) {
      const status = error instanceof RequestFailure ? error.status : 503;
      return safeResponse(
        json({ error: status === 503 ? 'unavailable' : 'invalid_request' }, status),
      );
    }
  },
} satisfies ExportedHandler<Env>;
