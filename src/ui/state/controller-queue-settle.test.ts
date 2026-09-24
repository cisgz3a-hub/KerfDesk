// Machine Setup's read-only checks send `$I` from the Console and then read the
// settings; the read refuses while `$I`'s ok is still owed, so the checks wait
// for the queue first (controller audit 2026-09-23, settings-console-3).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForControllerQueueSettled } from './controller-queue-settle';
import { useLaserStore } from './laser-store';

afterEach(() => {
  vi.useRealTimers();
  useLaserStore.setState({ pendingUntrackedAcks: 0, pendingTransportWrites: 0 });
});

describe('waitForControllerQueueSettled', () => {
  it('resolves once the owed acknowledgement arrives', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    const settled = waitForControllerQueueSettled(2_000);
    await vi.advanceTimersByTimeAsync(300);
    useLaserStore.setState({ pendingUntrackedAcks: 0 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(settled).resolves.toBe(true);
  });

  it('gives up at the deadline when the ok never comes', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    const settled = waitForControllerQueueSettled(500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(settled).resolves.toBe(false);
  });
});
