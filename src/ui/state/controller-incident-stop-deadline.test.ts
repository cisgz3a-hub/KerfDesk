import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginCaptureTest,
  captureController,
  CAPTURE_IDLE,
  connectCaptureController,
  endCaptureTest,
} from '../../__fixtures__/controller-incident-capture';
import { incidentHistory } from '../../__fixtures__/controller-incidents';
import { useLaserStore } from './laser-store';
import { DISCONNECT_WRITE_TIMEOUT_MS } from './laser-disconnect-transaction';
import { flushConnect } from './laser-store-console.test-support';

describe('D1 distinct owned failures with equal diagnostic text', () => {
  beforeEach(beginCaptureTest);
  afterEach(endCaptureTest);

  it('retains a later cleanup deadline even when an earlier real write rejection had the same reason', async () => {
    const message = 'Serial write timed out during controller disconnect.';
    let failConsole = false;
    let hangCleanup = false;
    let finishCleanup: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const controller = captureController({
      statusReply: () => CAPTURE_IDLE,
      write: async (data) => {
        if (failConsole && data === 'G4 P0\n') throw new Error(message);
        if (hangCleanup && data === 'M5\n') await pending;
      },
    });
    await connectCaptureController(controller.connection);
    failConsole = true;
    await expect(useLaserStore.getState().sendConsoleCommand('G4 P0')).rejects.toThrow(message);
    const first = incidentHistory().find((entry) => entry.raw.includes(message));
    expect(first).toBeDefined();
    if (first === undefined) throw new Error('Expected the original transport rejection.');
    expect(useLaserStore.getState().lastWriteError).toBe(message);
    failConsole = false;
    hangCleanup = true;
    const closing = useLaserStore.getState().disconnect();
    await vi.advanceTimersByTimeAsync(DISCONNECT_WRITE_TIMEOUT_MS + 100);
    await closing;
    const later = incidentHistory().filter(
      (entry) => entry.id > first.id && entry.raw.includes(message),
    );
    expect(later).toHaveLength(1);
    expect(later[0]?.raw).toContain('stop before disconnect failed');
    expect(later[0]?.at).toBeGreaterThan(first.at);
    expect(controller.closeCount()).toBe(1);
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'disconnect',
    });
    const beforeLate = incidentHistory();
    finishCleanup();
    await flushConnect();
    expect(incidentHistory()).toEqual(beforeLate);
  });
});
