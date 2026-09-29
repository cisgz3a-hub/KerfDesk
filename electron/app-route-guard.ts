/**
 * The checks every KerfDesk `app://app/api/...` route makes (ADR-523, ADR-546,
 * ADR-548): the exact app://app address with no port, credentials, query or
 * fragment, the route's own header, and a same-origin request. No web page or
 * other program can send those, so only KerfDesk's own window reaches a route.
 */
export function trustedAppRequest(request: Request, url: URL, header: string): boolean {
  return exactAppUrl(url) && sameOriginRequest(request, header);
}

function exactAppUrl(url: URL): boolean {
  return (
    url.protocol === 'app:' &&
    url.hostname === 'app' &&
    [url.port, url.username, url.password, url.search, url.hash].every((part) => part === '')
  );
}

/** The route's own header and a same-origin request (ADR-550 adds a query). */
export function sameOriginRequest(request: Request, header: string): boolean {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  return (
    request.headers.get(header) === '1' &&
    (origin === null || origin === 'app://app') &&
    (site === null || site === 'same-origin' || site === 'none')
  );
}
