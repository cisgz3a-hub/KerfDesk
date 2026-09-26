// Home on grblHAL at its default settings (controller audit 2026-09-25 ST-4).
// grblHAL's homing loop answers a status query only with "report when homing"
// (bit 12 of $10) on, and that is off by default:
//   machine_limits.c:336-337  if(settings.status_report.when_homing)
//                                 rt_exec_states |= EXEC_STATUS_REPORT;
//   https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L336-L337
//   config.h:752  #define DEFAULT_REPORT_WHEN_HOMING Off
// So a grblHAL Home is as silent as stock GRBL's, and KerfDesk must not time it
// out after 120 s of status silence while the machine goes on homing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const GRBL_HAL_BANNER = "GrblHAL 1.1f ['$' or '$HELP' for help]";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    controllerOperation: null,
    homingState: 'unknown',
    grblSettingsRows: [],
  });
  resetStore();
  vi.restoreAllMocks();
});

async function connectGrblHal(homingMs: number): Promise<GrblSimulator> {
  const sim = createGrblSimulator({
    firmware: 'grblhal',
    firmwareBanner: GRBL_HAL_BANNER,
    homingMs,
  });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'grblhal' });
  await vi.advanceTimersByTimeAsync(1_120);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('Home on grblHAL at its default settings', () => {
  it('keeps homing through 130 s of status silence and completes on the ok', async () => {
    const sim = await connectGrblHal(200_000);
    const home = useLaserStore
      .getState()
      .home()
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(sim.state().machine).toBe('Home');
    expect({
      homingState: useLaserStore.getState().homingState,
      safetyNotice: useLaserStore.getState().safetyNotice?.message ?? null,
    }).toEqual({ homingState: 'homing', safetyNotice: null });

    await vi.advanceTimersByTimeAsync(80_000);
    await expect(home).resolves.toBeUndefined();
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });
});
