// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { App, BrowserWindow } from 'electron';
import { installPackagedNativeSmoke } from './native-smoke.js';

it('retains the real UI without scripts or automatic exit and records no automated success', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'kerfdesk-interactive-observation-'));
  try {
    const contents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi.fn(),
      openDevTools: vi.fn(),
    });
    const window = Object.assign(new EventEmitter(), {
      webContents: contents,
      isVisible: () => true,
    });
    const app = { isPackaged: true, getPath: () => folder, quit: vi.fn(), exit: vi.fn() };
    const resultPath = join(folder, 'observation.json');
    installPackagedNativeSmoke({
      app: app as unknown as App,
      window: window as unknown as BrowserWindow,
      config: { userDataPath: folder, resultPath, interactive: true },
    });
    window.emit('ready-to-show');
    let result: Record<string, unknown> = {};
    await vi.waitFor(async () => {
      result = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(result.mode).toBe('interactive-observation');
    });
    expect(result).toMatchObject({ automatedSmoke: 'not-run', isolated: true, isPackaged: true });
    expect(result).not.toHaveProperty('ok');
    expect(contents.executeJavaScript).not.toHaveBeenCalled();
    expect(contents.openDevTools).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();
    expect(window.listenerCount('ready-to-show')).toBe(0);
  } finally {
    if (dirname(folder) !== tmpdir()) throw new Error('Unexpected test path');
    await rm(folder, { recursive: true, force: true });
  }
});
