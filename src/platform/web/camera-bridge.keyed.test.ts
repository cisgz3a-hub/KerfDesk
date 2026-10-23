// @vitest-environment node
// Rolling audit v2 04-P2-1 (ADR-141 Amendment 2): the desktop window sends a
// camera address only to the bridge its own main process started. The audit's
// repro had a program take the bridge's port first; the window then sent it
// `GET /probe?url=rtsp://admin:S3cret@…` and showed whatever it returned.

import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpCameraBridge, type CameraBridgeConnection } from './camera-bridge';

const ORIGIN = 'http://127.0.0.1:51731';
const LOGIN = 'rtsp://admin:S3cret@192.168.1.10:554/live';
const keys = {
  proofKey: randomBytes(32).toString('base64url'),
  clientToken: randomBytes(32).toString('base64url'),
};
const keyed: CameraBridgeConnection = { kind: 'keyed', origin: ORIGIN, ...keys };

function proofFor(proofKey: string, challenge: string): string {
  return createHmac('sha256', Buffer.from(proofKey, 'base64url'))
    .update(`kerfdesk-camera-bridge-proof/1:${challenge}`)
    .digest('base64url');
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Seen = { readonly url: string; readonly init: RequestInit | undefined };

/** A bridge on the port: KerfDesk's own (it knows `proofKey`), or a squatter. */
function bridgeOnPort(proofKey: string | null): Seen[] {
  const seen: Seen[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    seen.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname === '/health') {
      const challenge = parsed.searchParams.get('challenge') ?? '';
      return json({
        kind: 'ok',
        ffmpegAvailable: true,
        frameProxy: true,
        ...(proofKey === null ? {} : { proof: proofFor(proofKey, challenge) }),
      });
    }
    if (parsed.pathname === '/probe') {
      return json({
        kind: 'ok',
        url: LOGIN,
        ffmpegAvailable: true,
        previewUrl: `${ORIGIN}/stream.mjpg?session=s1`,
        streamSessionId: 's1',
      });
    }
    if (parsed.pathname === '/frame-source') {
      return json({ kind: 'ok', frameUrl: `${ORIGIN}/frame.jpg?source=f1` });
    }
    return json({ kind: 'ok', found: null });
  });
  return seen;
}

function headerOf(seen: Seen, name: string): string | undefined {
  return (seen.init?.headers as Record<string, string> | undefined)?.[name];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the desktop window checks its camera bridge before naming a camera', () => {
  it('sends the address, with the client token, only after a fresh proof', async () => {
    const seen = bridgeOnPort(keys.proofKey);
    const bridge = createHttpCameraBridge(async () => keyed);
    const result = await bridge.probeRtspCamera({ url: LOGIN });
    expect(result).toMatchObject({ kind: 'ok', previewUrl: `${ORIGIN}/stream.mjpg?session=s1` });
    expect(seen.map((request) => new URL(request.url).pathname)).toEqual(['/health', '/probe']);
    const [health, probe] = seen;
    if (health === undefined || probe === undefined) throw new Error('expected two requests');
    // The challenge is fresh and the health check carries neither token nor address.
    expect(new URL(health.url).searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(headerOf(health, 'X-KerfDesk-Camera-Bridge-Token')).toBeUndefined();
    expect(health.url).not.toContain('192.168.1.10');
    expect(headerOf(probe, 'X-KerfDesk-Camera-Bridge-Token')).toBe(keys.clientToken);
    expect(probe.init?.body).toBe(JSON.stringify({ url: LOGIN }));
    // A second request proves the bridge again, with another challenge.
    await bridge.registerFrameSource(LOGIN);
    const challenges = seen
      .filter((request) => new URL(request.url).pathname === '/health')
      .map((request) => new URL(request.url).searchParams.get('challenge'));
    expect(new Set(challenges).size).toBe(2);
  });

  it.each([
    ['answers without a proof', null],
    ['signs with another key', randomBytes(32).toString('base64url')],
  ])('sends nothing more to a program on the port that %s', async (_case, squatterKey) => {
    const seen = bridgeOnPort(squatterKey);
    const bridge = createHttpCameraBridge(async () => keyed);
    for (const result of [
      await bridge.probeRtspCamera({ url: LOGIN }),
      await bridge.registerFrameSource(LOGIN),
      await bridge.discoverMachineCamera(),
      await bridge.health(),
    ]) {
      expect(result).toEqual({
        kind: 'unavailable',
        reason: expect.stringContaining('Another program is answering on the port'),
      });
    }
    expect(seen.every((request) => new URL(request.url).pathname === '/health')).toBe(true);
    expect(seen.some((request) => JSON.stringify(request).includes('S3cret'))).toBe(false);
  });

  it('names the reason main gave, and contacts nothing, when the bridge did not start', async () => {
    const seen = bridgeOnPort(keys.proofKey);
    const reason = 'Another program on this computer is already using port 51731.';
    const bridge = createHttpCameraBridge(async () => ({ kind: 'unavailable', reason }));
    expect(await bridge.probeRtspCamera({ url: LOGIN })).toEqual({ kind: 'unavailable', reason });
    expect(await bridge.health()).toEqual({ kind: 'unavailable', reason });
    expect(await bridge.rtspStreamStatus('s1')).toEqual({ kind: 'unavailable', reason });
    expect(seen).toEqual([]);
  });

  it('does not say the bridge needs KerfDesk Desktop when the desktop bridge stops answering', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));
    const bridge = createHttpCameraBridge(async () => keyed);
    const result = await bridge.probeRtspCamera({ url: LOGIN });
    expect(result).toEqual({ kind: 'unavailable', reason: expect.stringContaining('not answering') });
    expect(JSON.stringify(result)).not.toContain('KerfDesk Desktop');
  });
});
