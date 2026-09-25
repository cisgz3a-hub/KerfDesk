// Controller audit MA-5: Marlin answers nothing for a line that is empty once
// its `;` comment is removed (gcode/queue.cpp L369-L372, L396-L405,
// L466-L468). The Console wrote `; note` owing an `ok` that never came, and
// every later Console command, poll, Jog, Frame and Start waited on it until
// Disconnect. The simulator now drops such lines as Marlin does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a comment-only Marlin Console line', () => {
  it('is refused before it is written, so later commands still run', async () => {
    const sim = createMarlinSimulator();
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await expect(useLaserStore.getState().sendConsoleCommand('; note')).rejects.toThrow(
      /only a comment/,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sim.outbound()).not.toContain('; note\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    await expect(useLaserStore.getState().sendConsoleCommand('M105')).resolves.toBeUndefined();
  });
});
