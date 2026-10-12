/* Imported by the generated service worker ahead of Workbox (vite.config.ts).
 *
 * The workspace document is cross-origin isolated (public/_headers), and such
 * a page only starts a worker whose script response itself carries COEP. The
 * precache keeps whatever response it first stored for a URL: content-hashed
 * worker chunks have revision null, so one stored before /assets/* gained COEP
 * stays headerless for as long as its code is unchanged, and the worker then
 * fails to load ("Trace worker errored"). Workbox still routes and caches
 * every request; this only adds the policy to a same-origin worker script it
 * answers without one. Keep the value equal to the workspace's in _headers. */
/* global self, FetchEvent, Response, Headers, URL */
(() => {
  const EMBEDDER_POLICY = 'credentialless';
  const WORKER_DESTINATIONS = new Set(['worker', 'sharedworker']);

  const isWorkerScript = (request) =>
    request.method === 'GET' &&
    WORKER_DESTINATIONS.has(request.destination) &&
    new URL(request.url).origin === self.location.origin;

  const withEmbedderPolicy = (response) => {
    // Opaque and error responses cannot be rebuilt; the browser judges them as is.
    if (!(response instanceof Response)) return response;
    if (response.type !== 'basic' && response.type !== 'default') return response;
    if (response.headers.has('Cross-Origin-Embedder-Policy')) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Embedder-Policy', EMBEDDER_POLICY);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  const respondWith = FetchEvent.prototype.respondWith;
  FetchEvent.prototype.respondWith = function (response) {
    if (!isWorkerScript(this.request)) return respondWith.call(this, response);
    return respondWith.call(this, Promise.resolve(response).then(withEmbedderPolicy));
  };
})();
