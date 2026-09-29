/* global console, Response */
import { FAULT_HEADER } from './http.mjs';
import { ROUTE, ROUTES } from './routes.mjs';

// One structured line per request: method, route, status, error code and duration,
// plus the webhook outcome and, on an unexpected error, the error's type. It never
// holds a body, key, token, licence ID, email or IP address. A path the service does
// not answer is logged as "other", because a mistyped URL could hold a key. Workers
// Logs keeps these lines only if the owner turns it on (ADR-523 Amendment 3).

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const CODE = /^[a-z_]{1,64}$/u;

async function responseDetails(response, route) {
  if (response.ok && route !== ROUTE.webhook) return {};
  try {
    const body = await response.clone().json();
    if (!response.ok) return CODE.test(body?.error?.code ?? '') ? { code: body.error.code } : {};
    if (body?.ignored === true) return { outcome: 'ignored' };
    if (body?.rejected === true) return { outcome: 'rejected' };
    return { outcome: body?.duplicate === true ? 'duplicate' : 'fulfilled' };
  } catch {
    return {};
  }
}

/** Logs the request and returns the response without the internal fault header. */
export async function logRequest(request, url, response, started) {
  const route = url && ROUTES.has(url.pathname) ? url.pathname : 'other';
  const fault = response.headers.get(FAULT_HEADER);
  let answer = response;
  if (fault !== null) {
    answer = new Response(response.body, response);
    answer.headers.delete(FAULT_HEADER);
  }
  const line = {
    message: 'licensing request',
    method: METHODS.has(request.method) ? request.method : 'OTHER',
    route,
    status: response.status,
    code: null,
    ...(await responseDetails(answer, route)),
    ...(fault === null ? {} : { fault }),
    ms: Math.max(0, Date.now() - started),
  };
  if (response.status >= 500) console.error(line);
  else if (line.outcome === 'rejected') console.warn(line);
  else console.log(line);
  return answer;
}
