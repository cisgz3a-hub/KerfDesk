import { vi } from 'vitest';
import { useLaserStore } from '../../ui/state/laser-store';

export function prepareCncPauseResumeTest(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

export async function resetCncPauseResumeTest(): Promise<void> {
  // Let the existing reset owner finish on the clock that armed its window.
  const disconnect = useLaserStore.getState().disconnect();
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(2_000);
  await disconnect;
  vi.useRealTimers();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    activeJobMachineKind: null,
    controllerSettings: null,
    accessoryCache: null,
    safetyNotice: null,
    lastWriteError: null,
    log: [],
  });
  vi.restoreAllMocks();
}
