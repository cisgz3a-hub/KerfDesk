// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDesktopBackgroundStartup, createDesktopStartup } from './desktop-startup';

const request = (path: string, init: RequestInit = {}) =>
  new Request(`app://app${path}`, {
    method: 'POST',
    headers: { 'X-KerfDesk-Desktop': '1', Origin: 'app://app' },
    ...init,
  });

function fixture() {
  const start = vi.fn();
  const fallback = vi.fn(async () => new Response('app route'));
  const startup = createDesktopStartup(start);
  return { start, fallback, startup, handle: startup.routes(fallback) };
}

describe('native background startup after the workspace opening gates', () => {
  it.each(['free', 'commercial'])('defers %s background work until readiness', async (channel) => {
    const licence = { config: { channel }, start: vi.fn() };
    const startCamera = vi.fn();
    const updater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      disableWebInstaller: false,
      checkForUpdatesAndNotify: vi.fn(async () => null),
    };
    const startup = createDesktopBackgroundStartup(licence, updater, {
      isPackaged: true,
      trustedUpdates: true,
      startCamera,
    });
    const handle = startup.routes(async () => new Response('app route'));
    await handle(request('/index.html', { method: 'GET' }));
    expect(licence.start).not.toHaveBeenCalled();
    expect(startCamera).not.toHaveBeenCalled();
    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    await handle(request('/api/desktop/workspace-ready'));
    await handle(request('/api/desktop/workspace-ready'));
    expect(licence.start).toHaveBeenCalledOnce();
    expect(startCamera).toHaveBeenCalledOnce();
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(channel === 'free' ? 1 : 0);
    expect(updater.autoDownload).toBe(channel === 'free');
  });

  it('serves the agreement UI, but starts no licence or update work before readiness', async () => {
    const app = fixture();
    expect(await (await app.handle(request('/index.html', { method: 'GET' }))).text()).toBe(
      'app route',
    );
    for (const action of ['status', 'refresh', 'trial', 'check-updates']) {
      const response = await app.handle(
        request(`/api/licensing/${action}`, {
          headers: { 'X-KerfDesk-Licensing': '1', Origin: 'app://app' },
        }),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(app.fallback).toHaveBeenCalledOnce();
    expect(app.start).not.toHaveBeenCalled();
  });

  it('opens once after acceptance and permits licence routes on reopening', async () => {
    const app = fixture();
    expect((await app.handle(request('/api/desktop/workspace-ready'))).status).toBe(204);
    expect((await app.handle(request('/api/desktop/workspace-ready'))).status).toBe(204);
    expect(app.start).toHaveBeenCalledOnce();
    expect(
      await (
        await app.handle(
          request('/api/licensing/status', {
            method: 'GET',
            headers: { 'X-KerfDesk-Licensing': '1' },
          }),
        )
      ).text(),
    ).toBe('app route');
  });

  it.each([
    ['foreign origin', { headers: { 'X-KerfDesk-Desktop': '1', Origin: 'https://evil.example' } }],
    [
      'cross-site request',
      { headers: { 'X-KerfDesk-Desktop': '1', 'Sec-Fetch-Site': 'cross-site' } },
    ],
    ['missing header', { headers: {} }],
    ['read request', { method: 'GET' }],
    ['unexpected body', { body: '{}' }],
  ] as const)('does not open on %s', async (_label, init) => {
    const app = fixture();
    expect((await app.handle(request('/api/desktop/workspace-ready', init))).status).toBe(404);
    expect(app.start).not.toHaveBeenCalled();
  });

  it.each(['?accept=1', '#ready'])('refuses an altered ready URL %s', async (suffix) => {
    const app = fixture();
    expect((await app.handle(request(`/api/desktop/workspace-ready${suffix}`))).status).toBe(404);
    expect(app.start).not.toHaveBeenCalled();
  });

  it('refuses foreign licence callers even before opening', async () => {
    const app = fixture();
    expect((await app.handle(request('/api/licensing/trial'))).status).toBe(404);
    expect(app.fallback).not.toHaveBeenCalled();
    expect(app.start).not.toHaveBeenCalled();
  });

  it('keeps licensing held after a startup failure and permits a successful retry', async () => {
    const app = fixture();
    app.start.mockImplementationOnce(() => {
      throw new Error('Not ready');
    });
    expect((await app.handle(request('/api/desktop/workspace-ready'))).status).toBe(503);
    expect(
      (
        await app.handle(
          request('/api/licensing/status', {
            headers: { 'X-KerfDesk-Licensing': '1' },
          }),
        )
      ).status,
    ).toBe(503);
    expect((await app.handle(request('/api/desktop/workspace-ready'))).status).toBe(204);
    expect(app.start).toHaveBeenCalledTimes(2);
  });

  it('supports unpackaged loopback development startup without repeated schedules', async () => {
    const app = fixture();
    app.startup.open();
    app.startup.open();
    expect(app.start).toHaveBeenCalledOnce();
    expect((await app.handle(request('/api/desktop/workspace-ready'))).status).toBe(204);
    expect(app.start).toHaveBeenCalledOnce();
  });
});
