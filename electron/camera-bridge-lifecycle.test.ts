// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { cameraBridgeLifecycle, cameraBridgeStartFailure } from './camera-bridge-lifecycle';

describe('camera bridge runs only behind an admitted workspace (ADR-623)', () => {
  it('starts once, stops before starting again, and never overlaps on its port', async () => {
    const events: string[] = [];
    let listening = 0;
    const start = vi.fn(async () => {
      listening += 1;
      events.push(`start:${listening}`);
      return {
        close: async () => {
          await Promise.resolve();
          listening -= 1;
          events.push(`stop:${listening}`);
        },
      };
    });
    const camera = cameraBridgeLifecycle(start, vi.fn());
    void camera.setRunning(true);
    void camera.setRunning(true);
    void camera.setRunning(false);
    await camera.setRunning(true);
    expect(events).toEqual(['start:1', 'stop:0', 'start:1']);
    await camera.close();
    expect(listening).toBe(0);
  });

  it('reports a bridge that could not start and can try again later', async () => {
    const report = vi.fn();
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error('port in use'))
      .mockResolvedValue({ close: async () => undefined });
    const camera = cameraBridgeLifecycle(start, report);
    await camera.setRunning(true);
    expect(report).toHaveBeenCalledWith('RTSP camera bridge could not start:', expect.any(Error));
    await camera.setRunning(true);
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe('the camera panel hears why the bridge is not running (audit v2 04-P2-1)', () => {
  function portError(code: string): Error {
    return Object.assign(new Error(`listen ${code}: 127.0.0.1:51731`), { code });
  }

  it('keeps the real reason a start failed, and tries again when asked', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(portError('EADDRINUSE'))
      .mockResolvedValue({ close: async () => undefined });
    const camera = cameraBridgeLifecycle(start, vi.fn());
    expect(camera.status()).toEqual({ kind: 'stopped' });
    await camera.setRunning(true);
    expect(camera.status()).toEqual({
      kind: 'failed',
      reason: expect.stringContaining('Another program on this computer is already using port 51731'),
    });
    // The program holding the port closed: the next camera connect starts it.
    await camera.retry();
    expect(camera.status()).toEqual({ kind: 'running' });
    expect(start).toHaveBeenCalledTimes(2);
    await camera.retry();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('does not start a bridge the workspace no longer wants', async () => {
    const start = vi.fn().mockRejectedValue(portError('EADDRINUSE'));
    const camera = cameraBridgeLifecycle(start, vi.fn());
    await camera.setRunning(true);
    await camera.setRunning(false);
    expect(camera.status()).toEqual({ kind: 'stopped' });
    await camera.retry();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('names a port Windows set aside, and any other failure, in plain words', () => {
    expect(cameraBridgeStartFailure(portError('EACCES'), 51731)).toContain(
      'does not let KerfDesk use port 51731',
    );
    expect(cameraBridgeStartFailure(portError('EMFILE'), 51731)).toContain(
      'could not start (EMFILE)',
    );
    expect(cameraBridgeStartFailure(new Error('odd'), 51731)).not.toContain('KerfDesk Desktop');
  });
});

describe('the main window losing its workspace stops the camera (ADR-623)', () => {
  it('clears admission on a renderer crash and on a closed window', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // macOS keeps KerfDesk running with no window, so close must count too.
    expect(main).toMatch(/webContents\.on\('render-process-gone', \(\) => rendererGone\?\.\(\)\)/);
    expect(main).toMatch(/window\.on\('closed', \(\) => rendererGone\?\.\(\)\)/);
  });
});
