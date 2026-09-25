// Controller audit 2026-09-25 CG-9 (regression). Auto-focus sends one operator
// line, so the driver's Console policy applies to it. Smoothieware's SimpleShell
// answers lowercase words such as `switch focus on` with its own text and never
// `ok` (SimpleShell.cpp L205-L297, GcodeDispatch.cpp L75-L82), so sending one
// left an owed acknowledgement that fenced Jog, Frame, Home and Start for the
// rest of the session.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L205-L297

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator } from '../../__fixtures__/controllers';
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
    autofocusBusy: false,
    controllerOperation: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('auto-focus follows the driver Console policy', () => {
  it('refuses a Smoothieware shell command that never answers ok, and sends nothing', async () => {
    const sim = createSmoothieSimulator();
    useStore.getState().updateDeviceProfile({
      controllerKind: 'smoothieware',
      autofocusCommand: 'switch focus on',
    });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    const result = await useLaserStore.getState().autofocus('switch focus on');

    expect(result.kind).toBe('preflight-failed');
    if (result.kind === 'preflight-failed') expect(result.reason).toMatch(/without an ok/);
    expect(sim.outbound()).not.toContain('switch focus on\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});
