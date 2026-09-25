// Audit CG-12 repro: on a controller without a jog-cancel byte, the keyboard
// Abort (Ctrl/Cmd+.) does not stop a Frame or jog that is moving.
//
// use-job-shortcuts.ts documents Ctrl+. as "Request the controller-specific
// Abort" and says it follows the Live Motion bar ("the keyboard Abort must stop
// whatever the bar offers ABORT or LASER OFF for"). For a jog/Frame the bar's
// ABORT MOTION calls stopJob (LiveMotionBar.tsx `abort = ... : stopJob`), but the
// shortcut calls `laser.cancelJog()` ("Jog and Frame keep the gentler
// jog-cancel"). cancelJog writes the driver's jogCancel byte and returns
// without writing anything when it is null (laser-motion-cancel.ts
// writeJogCancel: `if (jogCancel === null) return undefined;`), then waits for
// the motion to settle. jogCancel is null on Smoothieware, Marlin and the Falcon
// contract (smoothieware/driver.ts, marlin/driver.ts, falcon-command-contract.ts).
// The rotary test already works around exactly this
// (rotary-test-rotation.ts stopRotaryTestMotion:
// `moving && !state.capabilities.jogCancel ? state.stopJob() : state.cancelJog()`).
//
// Upstream: Smoothieware has no jog-cancel command; plain G0 moves queued in the
// planner run to completion unless the board is halted (Ctrl-X sets halt_flag,
// on_idle calls ON_HALT which flushes the queue):
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L204-L312
//
// Correct behaviour: on a driver without jog-cancel, Ctrl+. during a jog/Frame
// sends the same controller Abort as the bar's ABORT MOTION (Ctrl-X here).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { installJobShortcuts } from '../../ui/laser/use-job-shortcuts';
import { createUpstreamSmoothie } from './upstream-smoothie-fake';

let uninstall: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
});

afterEach(async () => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    motionOperation: null,
    controllerOperation: null,
    safetyNotice: null,
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function framingSmoothie(): Promise<ReturnType<typeof createUpstreamSmoothie>> {
  const board = createUpstreamSmoothie({ motionMsPerMove: 3_000 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(board.adapter, { controllerKind: 'smoothieware' });
  await pump(2_500);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  void useLaserStore
    .getState()
    .frame({ minX: 10, minY: 10, maxX: 60, maxY: 60 }, 3_000)
    .catch(() => undefined);
  for (let t = 0; t < 300 && !board.isMoving(); t += 1) await pump(10);
  await pump(500);
  expect(board.isMoving()).toBe(true);
  expect(useLaserStore.getState().motionOperation?.kind).toBe('frame');
  return board;
}

describe('CG-12: keyboard Abort during a Frame on a controller without jog-cancel', () => {
  it('Ctrl+. stops the Frame motion on Smoothieware', async () => {
    const board = await framingSmoothie();
    uninstall = installJobShortcuts(window);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true }));
    await pump(1_000);
    // Fails today: nothing is written (no Ctrl-X), the board keeps moving
    // through the rest of the perimeter.
    expect(
      { resetSent: board.outbound().includes('\x18'), stillMoving: board.isMoving() },
      JSON.stringify(board.outbound().slice(-6)),
    ).toEqual({ resetSent: true, stillMoving: false });
  });

  it("control: the Live Motion bar's ABORT MOTION (stopJob) does stop it", async () => {
    const board = await framingSmoothie();
    void useLaserStore
      .getState()
      .stopJob()
      .catch(() => undefined);
    await pump(1_000);
    expect(board.outbound()).toContain('\x18');
    expect(board.isMoving()).toBe(false);
  });
});
