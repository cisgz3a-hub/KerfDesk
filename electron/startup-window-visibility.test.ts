// @vitest-environment node
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { installStartupWindowVisibility } from './startup-window-visibility';

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }));

class FakeWindow extends EventEmitter {
  visible = false;
  minimized = false;
  destroyed = false;
  readonly webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async (_script: string) => undefined),
  });
  isVisible() {
    return this.visible;
  }
  isMinimized() {
    return this.minimized;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

describe('startup BrowserWindow visibility', () => {
  it('publishes hidden, shown, minimized and restored states independently of throttling', () => {
    const window = new FakeWindow();
    installStartupWindowVisibility(window as unknown as BrowserWindow);
    const dataset: Record<string, string> = {};
    const dispatchEvent = vi.fn();
    const applyLatest = () => {
      const script = window.webContents.executeJavaScript.mock.lastCall?.[0];
      if (script === undefined) throw new Error('missing publication');
      runInNewContext(script, {
        document: { documentElement: { dataset } },
        window: { dispatchEvent },
        Event,
      });
    };
    window.webContents.emit('dom-ready');
    applyLatest();
    expect(dataset.desktopWindowVisible).toBe('false');
    window.visible = true;
    window.emit('show');
    applyLatest();
    expect(dataset.desktopWindowVisible).toBe('true');
    const olderShow = window.webContents.executeJavaScript.mock.lastCall?.[0] as string;
    window.minimized = true;
    window.emit('minimize');
    applyLatest();
    expect(dataset.desktopWindowVisible).toBe('false');
    runInNewContext(olderShow, {
      document: { documentElement: { dataset } },
      window: { dispatchEvent },
      Event,
    });
    expect(dataset.desktopWindowVisible).toBe('false');
    window.minimized = false;
    window.emit('restore');
    applyLatest();
    expect(dataset.desktopWindowVisible).toBe('true');
    window.visible = false;
    window.emit('hide');
    applyLatest();
    expect(dataset.desktopWindowVisible).toBe('false');
    window.emit('closed');
    expect(window.listenerCount('show')).toBe(0);
    expect(window.webContents.listenerCount('dom-ready')).toBe(0);
  });

  it('does not deliver into a destroyed window', () => {
    const window = new FakeWindow();
    installStartupWindowVisibility(window as unknown as BrowserWindow);
    window.destroyed = true;
    window.emit('hide');
    expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
  });
});
