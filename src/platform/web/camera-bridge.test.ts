import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpCameraBridge } from './camera-bridge';

describe('web RTSP camera bridge client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unavailable when the local desktop bridge cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));

    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');
    const result = await bridge.probeRtspCamera({ url: 'rtsp://192.168.10.1:8554/' });

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'ok') throw new Error('expected unavailable bridge result');
    expect(result.reason).toContain('pnpm camera:bridge');
    expect(result.reason).toContain('LaserForge Desktop');
    expect(result.reason).toContain('browser camera picker');
  });

  it('returns probe status and preview URL from the local bridge', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'ok',
          url: 'rtsp://192.168.10.1:8554/',
          codec: 'H264',
          ffmpegAvailable: true,
          previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=x',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');
    const result = await bridge.probeRtspCamera({ url: 'rtsp://192.168.10.1:8554/' });

    expect(result).toEqual({
      kind: 'ok',
      url: 'rtsp://192.168.10.1:8554/',
      codec: 'H264',
      ffmpegAvailable: true,
      previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=x',
    });
  });

  it('rejects malformed bridge JSON instead of trusting a cast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ kind: 'ok', url: 'rtsp://192.168.10.1:8554/' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');
    const result = await bridge.probeRtspCamera({ url: 'rtsp://192.168.10.1:8554/' });

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'The local camera bridge returned an invalid response.',
    });
  });

  it('passes through valid invalid/unavailable bridge statuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ kind: 'invalid', reason: 'Only private RTSP hosts allowed.' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');
    const result = await bridge.probeRtspCamera({ url: 'rtsp://8.8.8.8/live' });

    expect(result).toEqual({ kind: 'invalid', reason: 'Only private RTSP hosts allowed.' });
  });
});
