// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
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
  function setup() {
    const updates = {
      status: () => state,
      check: () => state,
      settled: async () => undefined,
      download: vi.fn(() => state),
      installOnQuit: vi.fn(async () => ({
        ...state,
        state: 'ready' as const,
        installOnQuit: true,
      })),
    };
    const route = withLicensingRoutes(
      async () => new Response('fallback'),
      {} as LicensingRuntime,
      undefined,
      updates,
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
    for (const action of ['download-update', 'install-update-on-quit'])
      expect((await route(setup().request(action))).status).toBe(404);
  });
});
