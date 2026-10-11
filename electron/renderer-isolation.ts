export const RENDERER_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
} as const;

export function rendererResponsePolicyHeaders(
  csp: string,
  existing: Record<string, string | string[]> = {},
): Record<string, string | string[]> {
  const managed = new Set([
    ...Object.keys(RENDERER_ISOLATION_HEADERS).map((name) => name.toLowerCase()),
    'content-security-policy',
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(existing).filter(([name]) => !managed.has(name.toLowerCase())),
    ),
    ...Object.fromEntries(Object.entries(RENDERER_ISOLATION_HEADERS).map(([k, v]) => [k, [v]])),
    'Content-Security-Policy': [csp],
  };
}

/** Custom-protocol workers need isolation on the actual protocol response.
 * Electron 44's webRequest hook alone can leave app:// worker startup failing
 * even while the parent document reports crossOriginIsolated. */
export function withRendererIsolation(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(RENDERER_ISOLATION_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
