// Rolling audit v4 H3-P2-2 (ADR-392 Amendment 4). A setup package's one file
// per bit, run through Run G-code file, has its bit change between two runs.
// Frame accepted the previous bit's Work Z and Set origin could move the X/Y
// zero the later bits share; Start's M0 hold does neither. Driven through the
// real store, the real external Frame and Start, and the GRBL simulator.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { cncToolProgramHeader } from '../../io/cnc/cnc-tool-programs';
import { bitFileSequenceXyOriginBlockMessage } from '../state/bit-file-sequence';
import { useLaserStore } from '../state/laser-store';
import { toolChangeXyOriginBlockMessage } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { isWorkZEvidenceCurrentForStart } from '../state/work-z-zero-evidence';
import { frameExternalProgram } from './external-run';
import {
  connectGrbl,
  finishRun,
  openedProgram,
  resetExternalRunStores,
  settle,
  startOpenedProgram,
} from './external-run-simulator.test-support';

const MOTION = 'G21 G90 G54\nG0 X5 Y5\nG1 X10 Y5 F600\nM30\n';
const BIT_ONE = cncToolProgramHeader({ order: 1, count: 2 }, '3.175 mm (1/8") end mill') + MOTION;
const BIT_TWO = cncToolProgramHeader({ order: 2, count: 2 }, '6.35 mm (1/4") end mill') + MOTION;
// Long enough to be moving when Abort lands.
const LONG_BIT_ONE =
  cncToolProgramHeader({ order: 1, count: 2 }, '3.175 mm (1/8") end mill') +
  'G21 G90 G54\n' +
  'G1 X10 Y5 F600\nG1 X0 Y0\n'.repeat(30) +
  'M30\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  resetStore();
  useStore.getState().updateDeviceProfile({ controllerKind: 'grbl-v1.1' });
  useStore.setState({
    project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
  });
});

afterEach(async () => {
  await resetExternalRunStores();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function workZCurrent(): boolean {
  const laser = useLaserStore.getState();
  return isWorkZEvidenceCurrentForStart(
    laser.workZZeroEvidence,
    laser.workZReferenceEpoch,
    laser.controllerSessionEpoch,
  );
}

async function zeroedCnc(): Promise<void> {
  await connectGrbl();
  await settle(useLaserStore.getState().zeroZHere());
  expect(workZCurrent()).toBe(true);
}

describe('per-bit files through Run G-code file', () => {
  it('voids Work Z after bit 1 of 2, so the next Frame waits for a new zero', async () => {
    await zeroedCnc();
    await startOpenedProgram(BIT_ONE);
    await finishRun();
    expect(workZCurrent()).toBe(false);
    expect(useLaserStore.getState().bitFileSequence).toMatchObject({ order: 1, count: 2 });

    // Declining the Frame's Zero Z offer leaves the next bit's file unframed.
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(await settle(frameExternalProgram(openedProgram(BIT_TWO)))).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('holds the X/Y origin between the files and releases it after the last bit', async () => {
    await zeroedCnc();
    await startOpenedProgram(BIT_ONE);
    await finishRun();
    const held = toolChangeXyOriginBlockMessage(useLaserStore.getState());
    expect(held).toContain('Bit 1 of 2 (3.175 mm (1/8") end mill) ran on this X/Y origin');
    // Caught before the clock advances, so the refusal is never an unhandled rejection.
    const refused = await settle(
      useLaserStore
        .getState()
        .setOriginHere()
        .then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
    );
    expect(refused).toContain('ran on this X/Y origin');
    expect(useLaserStore.getState().workOriginActive).toBe(false);

    // The new bit's zero is still allowed, and its file runs.
    await settle(useLaserStore.getState().zeroZHere());
    expect(workZCurrent()).toBe(true);
    await startOpenedProgram(BIT_TWO);
    await finishRun();
    expect(useLaserStore.getState().bitFileSequence).toBeNull();
    expect(toolChangeXyOriginBlockMessage(useLaserStore.getState())).toBeNull();
    // Each bit's Work Z belongs to its file, the last one's too.
    expect(workZCurrent()).toBe(false);
    await settle(useLaserStore.getState().setOriginHere());
    expect(useLaserStore.getState().workOriginActive).toBe(true);
  });

  it('ends the set when the operator ends it or the session ends', async () => {
    await zeroedCnc();
    await startOpenedProgram(BIT_ONE);
    await finishRun();
    useLaserStore.setState({ bitFileSequence: null });
    expect(toolChangeXyOriginBlockMessage(useLaserStore.getState())).toBeNull();

    await settle(useLaserStore.getState().zeroZHere());
    await startOpenedProgram(BIT_ONE);
    await finishRun();
    expect(useLaserStore.getState().bitFileSequence).not.toBeNull();
    await resetExternalRunStores();
    expect(bitFileSequenceXyOriginBlockMessage(useLaserStore.getState())).toBeNull();
  });

  // Rolling audit v5 J1-P3-1 (ADR-392 Amendment 5): Abort leaves the streamer
  // 'cancelled', which is never released, so the end patch never ran.
  it('ends an aborted bit file at the next Idle, holding X/Y for the later bits', async () => {
    await zeroedCnc();
    await startOpenedProgram(LONG_BIT_ONE);
    // The simulator acknowledges the lines before it moves: Abort lands mid-motion.
    expect(useLaserStore.getState().bitFileRun).toMatchObject({ order: 1, count: 2 });
    await settle(useLaserStore.getState().stopJob());
    await vi.advanceTimersByTimeAsync(1_000);
    // GRBL alarms on a reset mid-motion (ALARM:3); the bit ends at the first Idle.
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
    expect(useLaserStore.getState().bitFileRun).not.toBeNull();
    await settle(useLaserStore.getState().unlockAlarm());
    await vi.advanceTimersByTimeAsync(1_000);

    const laser = useLaserStore.getState();
    expect(laser.streamer?.status).toBe('cancelled');
    expect(laser.statusReport?.state).toBe('Idle');
    expect(laser.bitFileRun ?? null).toBeNull();
    expect(laser.bitFileSequence).toMatchObject({ order: 1, count: 2 });
    expect(toolChangeXyOriginBlockMessage(laser)).toContain('ran on this X/Y origin');
    expect(workZCurrent()).toBe(false);
  });

  it('keeps Work Z and sets no hold for a file with no bit header', async () => {
    await zeroedCnc();
    await startOpenedProgram(MOTION);
    await finishRun();
    expect(workZCurrent()).toBe(true);
    expect(useLaserStore.getState().bitFileSequence ?? null).toBeNull();
  });
});
