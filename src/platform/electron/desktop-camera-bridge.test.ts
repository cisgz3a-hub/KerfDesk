import { describe, expect, it, vi } from 'vitest';
import { desktopCameraBridgeConnection } from './desktop-camera-bridge';

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe('the desktop window asks main for its camera bridge (ADR-141 Amendment 2)', () => {
  it('asks app://app with the route header and takes the keys of a running bridge', async () => {
    const fetcher = vi.fn(async () =>
      reply({ kind: 'running', origin: 'http://127.0.0.1:51731', proofKey: 'p', clientToken: 't' }),
    );
    expect(await desktopCameraBridgeConnection(fetcher)).toEqual({
      kind: 'keyed',
      origin: 'http://127.0.0.1:51731',
      proofKey: 'p',
      clientToken: 't',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'app://app/api/camera-bridge/connection',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({ 'X-KerfDesk-Camera-Bridge': '1' }),
      }),
    );
  });

  it('passes on why the bridge is not running, and never falls back to an open bridge', async () => {
    const reason = 'Another program on this computer is already using port 51731.';
    expect(
      await desktopCameraBridgeConnection(async () => reply({ kind: 'unavailable', reason })),
    ).toEqual({ kind: 'unavailable', reason });
    for (const fetcher of [
      async () => reply({ kind: 'running', origin: 'http://127.0.0.1:51731' }),
      async () => reply('Not Found', 404),
      async () => {
        throw new TypeError('failed to fetch');
      },
    ]) {
      expect(await desktopCameraBridgeConnection(fetcher)).toEqual({
        kind: 'unavailable',
        reason: expect.stringContaining('Restart KerfDesk'),
      });
    }
  });
});
