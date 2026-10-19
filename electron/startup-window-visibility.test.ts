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
  closed = false;
  readonly contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => this.closed,
    executeJavaScript: vi.fn(async (_script: string) => undefined),
  });
  // Electron clears this reference by the time 'closed' is emitted.
  get webContents() {
    return this.closed ? null : this.contents;
  }
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
      const script = window.contents.executeJavaScript.mock.lastCall?.[0];
      if (script === undefined) throw new Error('missing publication');
      runInNewContext(script, {
        document: { documentElement: { dataset } },
        window: { dispatchEvent },
        Event,
      });
    };
    window.contents.emit('dom-ready');
    applyLatest();
    expect(dataset.desktopWindowVisible).toBe('false');
    window.visible = true;
    window.emit('show');
    applyLatest();
    expect(dataset.desktopWindowVisible).toBe('true');
    const olderShow = window.contents.executeJavaScript.mock.lastCall?.[0] as string;
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
    window.closed = true;
    expect(() => window.emit('hide')).not.toThrow();
    expect(() => window.emit('closed')).not.toThrow();
    for (const event of ['show', 'hide', 'minimize', 'restore', 'maximize', 'focus'])
      expect(window.listenerCount(event)).toBe(0);
    expect(window.contents.listenerCount('dom-ready')).toBe(0);
  });

  it('resynchronises a maximized reveal that emits no show event', () => {
    const window = new FakeWindow();
    installStartupWindowVisibility(window as unknown as BrowserWindow);
    window.visible = true;
    window.emit('maximize');
    expect(window.contents.executeJavaScript.mock.lastCall?.[0]).toContain(
      "desktopWindowVisible = 'true'",
    );
  });

  it('does not deliver into a destroyed window', () => {
    const window = new FakeWindow();
    installStartupWindowVisibility(window as unknown as BrowserWindow);
    window.destroyed = true;
    window.emit('hide');
    expect(window.contents.executeJavaScript).not.toHaveBeenCalled();
  });
});
