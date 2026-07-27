import { vi } from 'vitest';
import { useLaserStore } from '../../ui/state/laser-store';

export function prepareCncPauseResumeTest(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

export async function resetCncPauseResumeTest(): Promise<void> {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
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
