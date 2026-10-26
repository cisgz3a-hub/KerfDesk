// Controller audit v2 C6-P2-1: a Smoothieware Frame, jog and Home send
// `M221 S0` (SMOOTHIE_FRAME_TOOL_OFF_LINES), and Laser.cpp keeps that power
// scale until a reboot. An opened program must be Framed before Start
// (ADR-565), so a program that sets its power only with S burned nothing,
// while the Run review drew its burns at full power. The Smoothieware baseline
// now restores the power-up scale first (ADR-630 Amendment 3).
//
// Burns come from the simulator's upstream-ported power model
// (smoothie-laser-power-model.ts), which shares no code with the baseline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { externalProgramBaseline, normalizeExternalProgram } from '../../core/external-program';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { frameExternalProgram, startExternalProgram, type ExternalRun } from './external-run';

// The refuter's file: power only on the G1 lines, M3/M5 as LightBurn writes them.
const FILE = 'G00 G17 G40 G21 G54\nG90\nM3\nG0 X0 Y0\nG1 X10 Y0 S0.5 F600\nG1 X10 Y10\nM5\n';
const ENVELOPE = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    homingState: 'unknown',
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectSmoothieIdle(): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator();
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function smoothieRun(): ExternalRun {
  const normalized = normalizeExternalProgram(
    FILE,
    externalProgramBaseline('smoothieware'),
    'smoothieware',
  );
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  return {
    controllerKind: 'smoothieware',
    name: 'part.gcode',
    gcode: normalized.program.gcode,
    envelope: ENVELOPE,
    start: { x: 0, y: 0, z: 0 },
  };
}

describe('C6-P2-1: an opened program on Smoothieware after its Frame', () => {
  it('burns at the power the review shows, though the Frame zeroed the M221 scale', async () => {
    const sim = await connectSmoothieIdle();
    const framing = frameExternalProgram(smoothieRun());
    await pump(20_000);
    const frame = await framing;
    if (frame === null) throw new Error('the Frame did not complete');
    // The Frame's tool-off lines left the scale at zero, as on the board.
    expect(sim.state().laserScale).toBe(0);

    const started = startExternalProgram(frame);
    await pump(2_000);
    await expect(started).resolves.toBe(true);
    await pump(20_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().burns).toMatchObject([
      { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, power: 0.5 },
      { from: { x: 10, y: 0 }, to: { x: 10, y: 10 }, power: 0.5 },
    ]);
    expect(sim.state().laserScale).toBe(1);
    expect(sim.state().modelErrors).toEqual([]);
  });
});
