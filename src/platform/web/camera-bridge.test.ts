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

  it('maps /discover results to found / not-found / unavailable', async () => {
    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: 'ok',
          found: {
            cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
            proxyFrameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    expect(await bridge.discoverMachineCamera()).toEqual({
      kind: 'found',
      cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
      proxyFrameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ kind: 'ok', found: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await bridge.discoverMachineCamera()).toEqual({ kind: 'not-found' });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));
    const unavailable = await bridge.discoverMachineCamera();
    expect(unavailable.kind).toBe('unavailable');
    if (unavailable.kind === 'unavailable') {
      expect(unavailable.reason).toContain('pnpm camera:bridge');
    }
  });

  it('rejects malformed /discover JSON instead of trusting a cast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ kind: 'ok', found: { cameraUrl: 42 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');
    expect(await bridge.discoverMachineCamera()).toEqual({
      kind: 'unavailable',
      reason: 'The local camera bridge returned an invalid response.',
    });
  });

  it('builds pixel-readable proxied frame URLs', () => {
    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');
    expect(bridge.proxiedFrameUrl('http://192.168.10.1:8080/media/getCapturePhoto?a=b')).toBe(
      'http://127.0.0.1:51731/frame.jpg?url=http%3A%2F%2F192.168.10.1%3A8080%2Fmedia%2FgetCapturePhoto%3Fa%3Db',
    );
  });

  it('reports bridge health including the frame proxy capability', async () => {
    const bridge = createHttpCameraBridge('http://127.0.0.1:51731');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ kind: 'ok', ffmpegAvailable: false, frameProxy: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await bridge.health()).toEqual({
      kind: 'ok',
      ffmpegAvailable: false,
      frameProxy: true,
    });

    // A pre-ADR-116 desktop bridge without the proxy reports frameProxy false.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ kind: 'ok', ffmpegAvailable: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await bridge.health()).toEqual({
      kind: 'ok',
      ffmpegAvailable: true,
      frameProxy: false,
    });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));
    expect((await bridge.health()).kind).toBe('unavailable');
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
