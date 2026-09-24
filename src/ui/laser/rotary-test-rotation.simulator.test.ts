// Test rotation against the scripted GRBL simulator on the REAL laser store:
// the exact wire bytes of both turns, the out-pause-back order, a Stop that
// suppresses the return turn, and no laser-on word anywhere (ADR-373).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { DEFAULT_ROTARY_SETUP, type RotarySetup } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  planRotaryTestRotation,
  runRotaryTestRotation,
  stopRotaryTestMotion,
  type RotaryTestPlan,
} from './rotary-test-rotation';

const MEASURED_ROLLER: RotarySetup = {
  ...DEFAULT_ROTARY_SETUP,
  enabled: true,
  mmPerRotation: 40,
  rollerDiameterMm: 25,
};

// Any M3/M4 or a nonzero S word would be a laser-on request.
const LASER_ON_WORD = /\bM0*[34]\b|S0*[1-9]/i;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
  vi.restoreAllMocks();
});

async function connectIdle(falcon = false): Promise<GrblSimulator> {
  const sim = createGrblSimulator({ motionMs: 300 });
  if (falcon) useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
  const options = falcon ? connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE) : {};
  await useLaserStore.getState().connect(sim.adapter, options);
  await vi.advanceTimersByTimeAsync(1100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function rollerTurnPlan(): RotaryTestPlan {
  const plan = planRotaryTestRotation(MEASURED_ROLLER, 'drive', 6000);
  if (plan === null) throw new Error('Expected a plan');
  return plan;
}

async function runToEnd(plan: RotaryTestPlan) {
  const running = runRotaryTestRotation({ plan, signal: new AbortController().signal });
  let settled = false;
  void running.finally(() => {
    settled = true;
  });
  for (let tick = 0; tick < 200 && !settled; tick += 1) await vi.advanceTimersByTimeAsync(50);
  return running;
}

describe('rotary test rotation on the GRBL simulator', () => {
  it('turns the roller once with $J jogs and turns back to the start', async () => {
    const sim = await connectIdle();
    const before = sim.outbound().length;

    await expect(runToEnd(rollerTurnPlan())).resolves.toEqual({ kind: 'done' });

    const written = sim.outbound().slice(before);
    const turns = written.filter((line) => line.startsWith('$J='));
    expect(turns).toEqual(['$J=G91 G21 Y40.000 F240\n', '$J=G91 G21 Y-40.000 F240\n']);
    expect(written.filter((line) => LASER_ON_WORD.test(line))).toEqual([]);
    expect(sim.state().mpos.y).toBe(0);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('sends no return turn after Stop, only the jog cancel', async () => {
    const sim = await connectIdle();
    const before = sim.outbound().length;
    const controller = new AbortController();
    const running = runRotaryTestRotation({ plan: rollerTurnPlan(), signal: controller.signal });
    for (let tick = 0; tick < 40 && sim.state().machine !== 'Jog'; tick += 1) {
      await vi.advanceTimersByTimeAsync(5);
    }
    expect(sim.state().machine).toBe('Jog');

    controller.abort();
    const stopping = stopRotaryTestMotion(useLaserStore.getState());
    await expect(running).resolves.toEqual({ kind: 'stopped' });
    await vi.advanceTimersByTimeAsync(3000);
    await stopping;

    const written = sim.outbound().slice(before);
    expect(written).toContain('\x85');
    expect(written.filter((line) => line.startsWith('$J='))).toEqual(['$J=G91 G21 Y40.000 F240\n']);
  });

  it('uses the Falcon tool-off jog contract for both turns', async () => {
    const sim = await connectIdle(true);
    const before = sim.outbound().length;

    await expect(runToEnd(rollerTurnPlan())).resolves.toEqual({ kind: 'done' });

    const written = sim.outbound().slice(before);
    expect(written).toContain('M5\nG21 G91\nG1 Y40.000 F240 S0\nG90\n');
    expect(written).toContain('M5\nG21 G91\nG1 Y-40.000 F240 S0\nG90\n');
    expect(written.some((line) => line.includes('$J='))).toBe(false);
    expect(written.filter((line) => LASER_ON_WORD.test(line))).toEqual([]);
    expect(sim.state().mpos.y).toBe(0);
  });

  it.each(['cancelJog', 'stopJob'] as const)(
    'suppresses the return after %s from another surface during the pause',
    async (action) => {
      const sim = await connectIdle();
      const before = sim.outbound().length;
      let phase = '';
      const running = runRotaryTestRotation({
        plan: rollerTurnPlan(),
        signal: new AbortController().signal,
        onPhase: (next) => {
          phase = next;
        },
      });
      for (let tick = 0; tick < 400 && phase !== 'pausing'; tick += 1) {
        await vi.advanceTimersByTimeAsync(5);
      }
      expect(phase).toBe('pausing');
      expect(useLaserStore.getState().motionOperation).toBeNull();
      const stopping = useLaserStore.getState()[action]();
      await vi.advanceTimersByTimeAsync(3000);
      await stopping;
      await expect(running).resolves.toEqual({ kind: 'stopped' });
      expect(
        sim
          .outbound()
          .slice(before)
          .filter((line) => line.startsWith('$J=')),
      ).toEqual(['$J=G91 G21 Y40.000 F240\n']);
    },
  );
});
