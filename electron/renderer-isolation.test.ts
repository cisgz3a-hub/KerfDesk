// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rendererResponsePolicyHeaders, withRendererIsolation } from './renderer-isolation.js';

describe('custom-protocol renderer isolation', () => {
  it('replaces existing policy names case-insensitively to avoid invalid combined headers', () => {
    const headers = rendererResponsePolicyHeaders("script-src 'self'", {
      'cross-origin-opener-policy': ['same-origin'],
      'Cross-Origin-Embedder-Policy': ['credentialless'],
      'content-security-policy': ["script-src 'none'"],
      'Content-Type': ['text/javascript'],
    });
    expect(headers).toEqual({
      'Cross-Origin-Opener-Policy': ['same-origin'],
      'Cross-Origin-Embedder-Policy': ['credentialless'],
      'Content-Security-Policy': ["script-src 'self'"],
      'Content-Type': ['text/javascript'],
    });
  });
  it('places isolation on the response while preserving bytes, CSP and content metadata', async () => {
    const response = new Response(new Uint8Array([0, 97, 115, 109]), {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': 'application/wasm',
        'Content-Range': 'bytes 0-3/100',
        'Content-Security-Policy': "script-src 'self' 'wasm-unsafe-eval'",
      },
    });
    const isolated = withRendererIsolation(response);
    expect(isolated.status).toBe(206);
    expect(isolated.statusText).toBe('Partial Content');
    expect(isolated.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(isolated.headers.get('Cross-Origin-Embedder-Policy')).toBe('credentialless');
    expect(isolated.headers.get('Content-Type')).toBe('application/wasm');
    expect(isolated.headers.get('Content-Range')).toBe('bytes 0-3/100');
    expect(isolated.headers.get('Content-Security-Policy')).toBe(
      "script-src 'self' 'wasm-unsafe-eval'",
    );
    expect(new Uint8Array(await isolated.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
  });
});
