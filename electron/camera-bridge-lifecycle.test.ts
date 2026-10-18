// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { cameraBridgeLifecycle } from './camera-bridge-lifecycle';

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
