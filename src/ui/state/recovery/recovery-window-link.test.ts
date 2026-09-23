import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';
import { createStartIntent } from './start-intent';
import { linkRecoveryWindows, type RecoveryWindowChannel } from './recovery-window-link';

/** Two windows' channels: a message posted on one arrives on the other only. */
function channelPair(): [RecoveryWindowChannel, RecoveryWindowChannel] {
  const make = (): RecoveryWindowChannel & { peer?: RecoveryWindowChannel } => ({
    onmessage: null,
    postMessage(message) {
      queueMicrotask(() => this.peer?.onmessage?.({ data: message } as MessageEvent));
    },
    close: () => undefined,
  });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('recovery window link', () => {
  it('refreshes the other window when one window announces a change', async () => {
    const [a, b] = channelPair();
    const first = { refresh: vi.fn(async () => undefined) };
    const second = { refresh: vi.fn(async () => undefined) };
    const linkA = linkRecoveryWindows(first, a);
    linkRecoveryWindows(second, b);
    linkA.announce();
    await flush();
    expect(second.refresh).toHaveBeenCalledTimes(1);
    expect(first.refresh).not.toHaveBeenCalled();
  });

  it('coalesces a burst of announcements into one refresh and one trailing pass', async () => {
    const [a, b] = channelPair();
    let release: () => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const linkA = linkRecoveryWindows({ refresh: vi.fn(async () => undefined) }, a);
    linkRecoveryWindows({ refresh }, b);
    for (let i = 0; i < 5; i += 1) linkA.announce();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('is inert without a channel', () => {
    const link = linkRecoveryWindows({ refresh: vi.fn(async () => undefined) }, null);
    expect(() => link.announce()).not.toThrow();
  });
});

describe('repository slot-change announcements', () => {
  it('announces committed slot changes but not no-op mutations or progress', async () => {
    const onSlotsChanged = vi.fn();
    const repository = new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      onSlotsChanged,
    });
    await repository.initialize();
    const intent = createStartIntent({
      gcode: 'G21\nG1 X1 S100\n',
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: new Date().toISOString(),
    });
    await repository.armFreshStartIntent('run-a', intent);
    expect(onSlotsChanged).toHaveBeenCalledTimes(1);
    // Refused: a Start is already pending, so nothing changes.
    await repository.armFreshStartIntent('run-b', intent);
    expect(onSlotsChanged).toHaveBeenCalledTimes(1);
    await repository.cancelPendingStart('run-a');
    expect(onSlotsChanged).toHaveBeenCalledTimes(2);
  });
});
