// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFrameBytes } from './camera-frame-proxy';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP camera login transport', () => {
  it('sends decoded Basic credentials in a header, preserving query identity and redirect refusal', async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return new Response(Uint8Array.from([255, 216, 255, 217]), {
          headers: { 'content-type': 'image/jpeg' },
        });
      }),
    );
    const result = await fetchFrameBytes(
      'http://oper%40ator:p%3Ass%40word@192.168.1.50:8080/shot.jpg?camera=2&token=live',
      1000,
    );
    expect(result.kind).toBe('ok');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://192.168.1.50:8080/shot.jpg?camera=2&token=live');
    expect(requests[0]?.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('oper@ator:p:ss@word').toString('base64')}`,
    );
    expect(requests[0]?.redirect).toBe('error');
    expect(requests[0]?.signal.aborted).toBe(false);
  });

  it('does not return credential-bearing fetch errors to the renderer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed http://user:password@192.168.1.50/frame?token=secret');
      }),
    );
    expect(
      await fetchFrameBytes('http://user:password@192.168.1.50/frame?token=secret', 1000),
    ).toEqual({ kind: 'failed', reason: 'Camera frame fetch failed.' });
  });
});
