// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

const windows = vi.hoisted(() => [] as unknown[]);
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => windows } }));

import { DESKTOP_PROJECT_OPEN_SIGNAL, installDesktopProjectOpens } from './desktop-project-open.js';

let root = '';
let savedArgv: string[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'kerfdesk-project-open-'));
  savedArgv = process.argv;
  windows.length = 0;
});

afterEach(async () => {
  process.argv = savedArgv;
  await rm(root, { recursive: true, force: true });
});

function fakeApp(lock = true) {
  const listeners = new Map<string, Listener>();
  const app = {
    requestSingleInstanceLock: vi.fn(() => lock),
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
      return app;
    }),
    getPath: vi.fn(() => root),
  };
  return { app, listeners };
}

function fakeWindow(url = 'app://app/index.html') {
  return {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      getURL: () => url,
      executeJavaScript: vi.fn(async () => undefined),
    },
  };
}

async function projectFile(name: string, contents = '{"schemaVersion":7}'): Promise<string> {
  const file = path.join(root, name);
  await writeFile(file, contents);
  return file;
}

function install(app: ReturnType<typeof fakeApp>['app']) {
  return installDesktopProjectOpens(app as never, {
    isTrustedRenderer: (url) => url.startsWith('app://app/'),
  });
}

async function drain(opens: ReturnType<typeof install>): Promise<unknown> {
  const handler = opens.routes(async () => new Response('bundle'));
  const response = await handler(new Request('app://app/api/desktop-project-opens'));
  return ((await response.json()) as { requests: unknown }).requests;
}

describe('installDesktopProjectOpens', () => {
  it('sends a second launch’s projects to the running app and then steps aside', async () => {
    process.argv = ['KerfDesk.exe', path.join(root, 'sign.lf2')];
    const { app, listeners } = fakeApp(false);

    const opens = install(app);

    expect(opens.hasSingleInstanceLock).toBe(false);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledWith({
      kerfdeskProjectPaths: [path.join(root, 'sign.lf2')],
    });
    expect(listeners.size).toBe(0);
  });

  it('queues the project a first launch was started with until the window asks', async () => {
    const file = await projectFile('Coasters.lf2');
    process.argv = ['KerfDesk.exe', file];
    const opens = install(fakeApp().app);

    const requests = await drain(opens);

    expect(requests).toEqual([
      expect.objectContaining({ kind: 'file', name: 'Coasters.lf2', path: file, size: 19 }),
    ]);
    await expect(drain(opens)).resolves.toEqual([]);
  });

  it('serves a queued project through its token', async () => {
    const file = await projectFile('Coasters.lf2', 'project bytes');
    process.argv = ['KerfDesk.exe', file];
    const opens = install(fakeApp().app);
    const [request] = (await drain(opens)) as Array<{ path: string; token: string }>;
    if (request === undefined) throw new Error('expected a queued project');

    const handler = opens.routes(async () => new Response('bundle'));
    const params = new URLSearchParams({ path: request.path, token: request.token });
    const response = await handler(
      new Request(`app://app/api/desktop-project-file?${params.toString()}`),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('project bytes');
  });

  it('raises the window, queues the second launch’s project and signals the renderer', async () => {
    process.argv = ['KerfDesk.exe'];
    const { app, listeners } = fakeApp();
    const window = fakeWindow();
    windows.push(window);
    const opens = install(app);
    const file = await projectFile('Second.lf2');

    listeners.get('second-instance')?.({}, ['KerfDesk.exe'], root, {
      kerfdeskProjectPaths: [file],
    });

    expect(window.restore).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(DESKTOP_PROJECT_OPEN_SIGNAL);
    await expect(drain(opens)).resolves.toEqual([
      expect.objectContaining({ kind: 'file', name: 'Second.lf2' }),
    ]);
  });

  it('falls back to the second launch’s argv when it sent no launch data', async () => {
    process.argv = ['KerfDesk.exe'];
    const { app, listeners } = fakeApp();
    const opens = install(app);
    await projectFile('Relative.lf2');

    listeners.get('second-instance')?.({}, ['KerfDesk.exe', 'Relative.lf2'], root, undefined);

    await expect(drain(opens)).resolves.toEqual([
      expect.objectContaining({ kind: 'file', path: path.join(root, 'Relative.lf2') }),
    ]);
  });

  it('never runs script in a window that left the trusted renderer', async () => {
    process.argv = ['KerfDesk.exe'];
    const { app, listeners } = fakeApp();
    const window = fakeWindow('https://example.com/');
    windows.push(window);
    install(app);

    listeners.get('second-instance')?.({}, ['KerfDesk.exe'], root, { kerfdeskProjectPaths: [] });

    expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('takes macOS Finder opens and reports files that cannot be opened', async () => {
    process.argv = ['KerfDesk'];
    const { app, listeners } = fakeApp();
    const opens = install(app);
    const event = { preventDefault: vi.fn() };

    listeners.get('open-file')?.(event, path.join(root, 'gone.lf2'));

    expect(event.preventDefault).toHaveBeenCalled();
    await expect(drain(opens)).resolves.toEqual([
      { kind: 'unavailable', name: 'gone.lf2', reason: 'missing' },
    ]);
  });
});
