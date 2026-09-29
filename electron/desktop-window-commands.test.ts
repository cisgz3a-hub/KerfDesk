// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, shell: {} }));

import { withDesktopWindowCommands } from './desktop-window-commands';

function routes(openFailure = '') {
  const commands = {
    exit: vi.fn(),
    openDataFolder: vi.fn(async () => openFailure),
    dataFolder: vi.fn(() => 'C:\\Users\\Maker\\AppData\\Roaming\\laserforge'),
  };
  const fallback = vi.fn(async () => new Response('asset'));
  return { commands, fallback, handle: withDesktopWindowCommands(fallback, commands) };
}

function request(path: string, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(`app://app${path}`, {
    method,
    headers: { 'X-KerfDesk-Desktop': '1', Origin: 'app://app', ...headers },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('desktop window commands', () => {
  it('answers Exit first and then quits through the close guard', async () => {
    const h = routes();
    const response = await h.handle(request('/api/desktop/exit'));
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(h.commands.exit).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(h.commands.exit).toHaveBeenCalledOnce();
  });

  it('opens the data folder', async () => {
    const h = routes();
    const response = await h.handle(request('/api/desktop/data-folder'));
    expect(response.status).toBe(204);
    expect(h.commands.openDataFolder).toHaveBeenCalledOnce();
    expect(h.commands.exit).not.toHaveBeenCalled();
  });

  it('says where the data folder is when the file manager cannot open it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = routes('No application is associated with the folder.');
    const response = await h.handle(request('/api/desktop/data-folder'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      folder: 'C:\\Users\\Maker\\AppData\\Roaming\\laserforge',
    });
    expect(warn).toHaveBeenCalledWith(
      'The data folder could not be opened: No application is associated with the folder.',
    );
    warn.mockRestore();
  });

  it('leaves every other path, including the job report route, to the next handler', async () => {
    const h = routes();
    expect(await (await h.handle(request('/index.html', {}, 'GET'))).text()).toBe('asset');
    expect(await (await h.handle(request('/api/desktop/activity'))).text()).toBe('asset');
    expect(h.fallback).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a foreign page', '/api/desktop/exit', { Origin: 'https://evil.example' }, 'POST'],
    ['a cross-site request', '/api/desktop/exit', { 'Sec-Fetch-Site': 'cross-site' }, 'POST'],
    ['no route header', '/api/desktop/data-folder', { 'X-KerfDesk-Desktop': '' }, 'POST'],
    ['a read', '/api/desktop/exit', {}, 'GET'],
    ['a query', '/api/desktop/exit?now=1', {}, 'POST'],
  ])('refuses %s', async (_name, path, headers, method) => {
    const h = routes();
    expect((await h.handle(request(path, headers, method))).status).toBe(404);
    vi.runAllTimers();
    expect(h.commands.exit).not.toHaveBeenCalled();
    expect(h.commands.openDataFolder).not.toHaveBeenCalled();
    expect(h.fallback).not.toHaveBeenCalled();
  });
});
