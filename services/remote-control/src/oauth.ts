import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import {
  PUBLIC_ORIGIN,
  MAX_METADATA_BYTES,
  OAUTH_READ,
  OAUTH_EDIT,
  oauthScopes,
} from './protocol.js';
import { DEFAULT_CSP, RequestFailure, boundedText, escapeHtml, originAllowed } from './security.js';
import { approvedSession, device } from './relay.js';
export type AppEnv = Env & { OAUTH_PROVIDER?: OAuthHelpers };
type ApprovedSession = NonNullable<Awaited<ReturnType<typeof approvedSession>>>;
function html(title: string, content: string, headers?: Headers): Response {
  const output = new Headers(headers);
  output.set('Content-Type', 'text/html; charset=utf-8');
  // A same-origin form navigation needs a non-null Origin; cross-origin callbacks receive no referrer.
  output.set('Referrer-Policy', 'same-origin');
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · KerfDesk</title><link rel="stylesheet" href="/control.css"></head><body><main class="shell"><a class="brand" href="/control">KerfDesk<span>Phone control</span></a>${content}</main></body></html>`,
    { headers: output },
  );
}

function pairFirst(request: Request): Response {
  const url = new URL(request.url);
  const continueTo = `${url.pathname}${url.search}`;
  if (continueTo.length > MAX_METADATA_BYTES) throw new RequestFailure(400);
  return html(
    'Approve your computer',
    `<section class="card"><h1>Connect your computer first</h1><p>Open KerfDesk on your PC, enable phone access, then create a pairing code. Approve this browser on the PC before connecting an MCP client.</p><a class="button" href="/control?continue=${escapeHtml(encodeURIComponent(continueTo))}">Pair this browser</a></section>`,
  );
}
async function consentPage(
  request: Request,
  oauth: OAuthHelpers,
  session: ApprovedSession,
): Promise<Response> {
  const authRequest = await oauth.parseAuthRequest(request);
  const description = await oauth.describeConsent(authRequest);
  const requested = description.scope;
  if (
    !requested.includes(OAUTH_READ) ||
    requested.some((scope) => ![OAUTH_READ, OAUTH_EDIT, 'offline_access'].includes(scope))
  )
    throw new RequestFailure(400);
  const canEdit = session.info.client.scopes.includes('edit');
  if (requested.includes(OAUTH_EDIT) && !canEdit)
    return html(
      'Read access only',
      '<section class="card"><h1>This computer approved read access</h1><p>To let this client edit, pair again and approve read and edit access on the PC. Then reconnect the MCP client.</p></section>',
    );
  const transaction = await oauth.beginConsent(authRequest);
  // Chromium applies form-action to the 303 callback too. Admit only the provider-validated return origin.
  const returnOrigin = new URL(description.redirectUri).origin;
  if (returnOrigin === 'null') throw new RequestFailure(400);
  transaction.headers.set(
    'Content-Security-Policy',
    DEFAULT_CSP.replace("form-action 'self'", `form-action 'self' ${returnOrigin}`),
  );
  const scopeInputs = requested
    .map((scope) => `<input type="hidden" name="scope" value="${escapeHtml(scope)}">`)
    .join('');
  const editDescription = requested.includes(OAUTH_EDIT)
    ? '<li>Add text and rectangles, select artwork, move or rotate it, and change existing laser operation settings.</li>'
    : '';
  return html(
    'Approve MCP access',
    `<section class="card"><p class="eyebrow">Computer approval</p><h1>Allow ${escapeHtml(description.clientName)}?</h1><p>This client will connect to <strong>${escapeHtml(session.info.deviceLabel)}</strong>.</p><dl><dt>Client</dt><dd>${escapeHtml(description.clientDomain ?? description.clientId)}</dd><dt>Return address</dt><dd>${escapeHtml(description.redirectHost)}${description.redirectIsLoopback ? ' (local app on this device)' : ''}</dd></dl><p>Only continue if you recognise this client and return address.</p><ul><li>Read the open workspace, machine profile, job review and app status.</li>${editDescription}${requested.includes('offline_access') ? '<li>Reconnect with this approval for up to 30 days. You can revoke access in KerfDesk at any time.</li>' : ''}</ul><p>KerfDesk must be open on the PC. This access cannot start a job, move a machine, open files or change your licence.</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escapeHtml(transaction.handle)}">${scopeInputs}<div class="actions"><button name="decision" value="allow">Allow access</button><button class="secondary" name="decision" value="deny">Decline</button></div></form></section>`,
    transaction.headers,
  );
}
async function decideConsent(
  request: Request,
  env: Env,
  oauth: OAuthHelpers,
  session: ApprovedSession,
): Promise<Response> {
  if (
    request.method !== 'POST' ||
    !originAllowed(request, PUBLIC_ORIGIN, true) ||
    request.headers.get('Content-Type')?.split(';')[0].trim() !==
      'application/x-www-form-urlencoded'
  )
    throw new RequestFailure(403);
  const form = new URLSearchParams(await boundedText(request, 16 * 1024));
  const handle = form.get('handle') ?? '';
  if (form.get('decision') === 'deny') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 303, headers: denied.headers });
  }
  if (form.get('decision') !== 'allow') throw new RequestFailure(400);
  const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope') });
  const scopes = oauthScopes(approved.request.scope);
  if (
    !scopes ||
    !scopes.every((scope) => session.info.client.scopes.includes(scope)) ||
    approved.request.scope.some(
      (scope) => ![OAUTH_READ, OAUTH_EDIT, 'offline_access'].includes(scope),
    )
  )
    throw new RequestFailure(403);
  const props = {
    deviceId: session.identity.deviceId,
    clientId: session.identity.clientId,
    leaseId: session.info.leaseId,
  };
  if (!(await device(env, props.deviceId).authorize(props, scopes))) throw new RequestFailure(403);
  const result = await oauth.completeAuthorization({
    request: approved.request,
    userId: `${props.deviceId}.${props.clientId}`,
    metadata: {},
    scope: approved.request.scope,
    props: { ...props, mcpGrantId: crypto.randomUUID() },
  });
  const headers = new Headers(approved.headers);
  headers.set('Location', result.redirectTo);
  return new Response(null, { status: 303, headers });
}
export async function authorizePage(request: Request, env: AppEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) throw new RequestFailure(503);
  const session = await approvedSession(request, env);
  if (session === null) return pairFirst(request);
  return request.method === 'GET'
    ? consentPage(request, oauth, session)
    : decideConsent(request, env, oauth, session);
}
