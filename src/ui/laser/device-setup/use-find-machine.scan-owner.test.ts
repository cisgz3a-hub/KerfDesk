// A scan's connection is the scan's only while the store's connect attempt is
// the one the scan started. Any connect or disconnect it did not make, such as
// auto-connect after a replug or one that lands while the scan's own open is
// still pending, takes the connection from it, so the scan closes nothing
// (2026-09-26 reviews of #941).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../../platform/types';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { scanBaudRates } from './device-setup-baud-scan';
import { liveConnectionAttempt } from './use-controller-auto-fill';
import { scanConnectionOwnership } from './use-find-machine';

const original = useLaserStore.getState();

beforeEach(() => {
  useLaserStore.setState({ ...initialLaserState(), connectionAttempt: 0 });
});

afterEach(() => {
  useLaserStore.setState(original, true);
});

// What the store's connect() and disconnect() do before their first await.
function moveAttempt(): void {
  useLaserStore.setState({ connectionAttempt: liveConnectionAttempt() + 1 });
}

describe('baud scan connection ownership', () => {
  it('moves the attempt synchronously on the real connect and disconnect', async () => {
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async () => null,
      serial: { isSupported: () => true, requestPort: async () => null },
    };
    const store = useLaserStore.getState();
    const connecting = store.connect(platform, { controllerKind: 'grbl-v1.1' });
    expect(liveConnectionAttempt()).toBe(1);
    await connecting;
    const closing = store.disconnect();
    expect(liveConnectionAttempt()).toBe(2);
    await closing;
  });

  it("keeps the scan's own open and close and flags anyone else's", async () => {
    const owner = scanConnectionOwnership();
    await owner.close(async () => moveAttempt());
    expect(owner.replaced()).toBe(false);
    await owner.open(async () => moveAttempt());
    expect(owner.replaced()).toBe(false);
    moveAttempt(); // auto-connect after a replug
    expect(owner.replaced()).toBe(true);
  });

  it('hands each attempt it opens to a continuing Find claim', async () => {
    const claimed: number[] = [];
    const owner = scanConnectionOwnership((attempt) => claimed.push(attempt));
    await owner.open(async () => moveAttempt());
    expect(claimed).toEqual([1]);
  });

  it('closes nothing when a connect lands while its own open is pending', async () => {
    let finishOpen: () => void = () => undefined;
    const owner = scanConnectionOwnership();
    const closes = vi.fn();
    const result = scanBaudRates(
      {
        connectAt: () =>
          owner.open(() => {
            moveAttempt();
            return new Promise<void>((resolve) => (finishOpen = resolve));
          }),
        disconnect: () =>
          owner.close(async () => {
            moveAttempt();
            closes();
          }),
        awaitAnswer: async () => 'silent',
        cancelled: owner.replaced,
      },
      [230400],
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Disconnected, then connecting and connected again by someone else.
    moveAttempt();
    moveAttempt();
    finishOpen();
    expect(await result).toEqual({ kind: 'cancelled' });
    // Only the scan's own close before it opened; no clean-up of the replacement.
    expect(closes).toHaveBeenCalledTimes(1);
  });
});
