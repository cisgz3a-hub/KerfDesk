// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withLicensingRoutes } from './licensing-routes.js';
import type { LicensingRuntime } from './licensing-runtime.js';
import type { UpdateStatus } from './update-status.js';

describe('same-origin manual update commands', () => {
  const state: UpdateStatus = {
    mode: 'manual',
    state: 'available',
    installOnQuit: false,
    currentVersion: '1.0.0',
    version: '1.0.1',
    checkedAt: 1,
  };
  afterEach(() => vi.useRealTimers());
  function setup(requestUpdateClose?: () => void) {
    const updates = {
      status: () => state,
      check: () => state,
      settled: async () => undefined,
      download: vi.fn(() => state),
      installOnQuit: vi.fn(
        async (): Promise<UpdateStatus> => ({
          ...state,
          state: 'ready' as const,
          installOnQuit: true,
        }),
      ),
    };
    const route = withLicensingRoutes(
      async () => new Response('fallback'),
      {} as LicensingRuntime,
      undefined,
      updates,
      requestUpdateClose,
    );
    const request = (action: string, body = '{}', origin = 'app://app', header = '1') =>
      new Request(`app://app/api/licensing/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'X-KerfDesk-Licensing': header,
        },
        body,
      });
    return { updates, route, request };
  }
  it('accepts only empty JSON commands and never accepts paths or URLs', async () => {
    const h = setup();
    for (const action of ['download-update', 'install-update-on-quit']) {
      expect((await h.route(h.request(action))).status).toBe(200);
      expect((await h.route(h.request(action, '{"url":"https://attacker.invalid"}'))).status).toBe(
        400,
      );
      expect((await h.route(h.request(action, '{"path":"C:/evil.exe"}'))).status).toBe(400);
      expect((await h.route(h.request(action, '{}', 'https://attacker.invalid'))).status).toBe(404);
      expect((await h.route(h.request(action, '{}', 'app://app', ''))).status).toBe(404);
    }
    expect(h.updates.download).toHaveBeenCalledOnce();
    expect(h.updates.installOnQuit).toHaveBeenCalledOnce();
  });
  it('does not expose download/install in the signed lane', async () => {
    const route = withLicensingRoutes(
      async () => new Response('fallback'),
      {} as LicensingRuntime,
      undefined,
      { status: () => state, check: () => state, settled: async () => undefined },
    );
    for (const action of ['download-update', 'install-update-on-quit', 'install-update-and-close'])
      expect((await route(setup().request(action))).status).toBe(404);
  });
  it('answers a verified explicit install choice before requesting guarded app close', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const h = setup(close);
    const reply = await h.route(h.request('install-update-and-close'));
    expect(await reply.json()).toMatchObject({
      state: 'ready',
      mode: 'manual',
      installOnQuit: true,
    });
    expect(h.updates.installOnQuit).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    { ...state, state: 'failed' as const },
    { ...state, state: 'ready' as const, installOnQuit: false },
    { ...state, state: 'not-covered' as const },
    { ...state, state: 'downloading' as const },
    {
      state: 'ready' as const,
      installOnQuit: true,
      currentVersion: '1.0.0',
      version: '1.0.1',
      checkedAt: 1,
    },
  ])('does not close on an unverified or unarmed update response %j', async (answer) => {
    vi.useFakeTimers();
    const close = vi.fn();
    const h = setup(close);
    h.updates.installOnQuit.mockResolvedValue(answer);
    await h.route(h.request('install-update-and-close'));
    vi.runAllTimers();
    expect(close).not.toHaveBeenCalled();
  });
  it('refuses unsupported, foreign or path-supplied install-and-close requests without arming', async () => {
    const h = setup();
    expect((await h.route(h.request('install-update-and-close'))).status).toBe(404);
    const guarded = setup(vi.fn());
    for (const [body, origin, header, code] of [
      ['{"path":"C:/evil.exe"}', 'app://app', '1', 400],
      ['{"url":"https://evil.invalid"}', 'app://app', '1', 400],
      ['{}', 'https://evil.invalid', '1', 404],
      ['{}', 'app://app', '', 404],
    ] as const)
      expect(
        (await guarded.route(guarded.request('install-update-and-close', body, origin, header)))
          .status,
      ).toBe(code);
    expect(h.updates.installOnQuit).not.toHaveBeenCalled();
    expect(guarded.updates.installOnQuit).not.toHaveBeenCalled();
  });
});
