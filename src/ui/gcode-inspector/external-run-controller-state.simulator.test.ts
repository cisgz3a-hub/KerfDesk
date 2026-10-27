// Controller audit v4 E4-P1-1 / E4-P2-1 (ADR-630 Amendment 6). An opened
// program that selects G55 with no M2/M30 after it leaves stock GRBL in G55
// (gcode.c L1091-1101), and the store kept G54, so the next Frame skipped its
// G54 selection and traced in G55. One that writes `G92 Z` or `G10 L20 Z`, or
// changes the tool, left the probed Work Z current, so the next CNC Frame and
// Start skipped Zero Z. Driven through the real store, the real external Frame
// and Start, and the GRBL simulator, which tracks the selected system and
// answers `$G` with it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { normalizeFrameWorkCoordinateSystem } from '../laser/frame-controller-readiness';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { isWorkZEvidenceCurrentForStart } from '../state/work-z-zero-evidence';
import {
  connectGrbl,
  finishRun,
  resetExternalRunStores,
  settle,
  startOpenedProgram,
} from './external-run-simulator.test-support';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  resetStore();
  useStore.getState().updateDeviceProfile({ controllerKind: 'grbl-v1.1' });
});

afterEach(async () => {
  await resetExternalRunStores();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('E4-P1-1: the WCS an opened program leaves active', () => {
  it('reads G55 back before the next Frame and selects G54', async () => {
    const sim = await connectGrbl();
    await startOpenedProgram('G21 G90\nG55\nG0 X5 Y5\nG1 X10 Y5 F600\n');
    // Gone before the first line could reach the controller, so a Stop is
    // covered as well as a completed run.
    expect(useLaserStore.getState().activeWcs).toBeNull();
    await finishRun();
    expect(sim.state().wcs).toBe('G55');
    expect(useLaserStore.getState().activeWcs).toBeNull();

    const normalized = await settle(normalizeFrameWorkCoordinateSystem());
    expect(normalized).toMatchObject({ ok: true, warning: expect.stringContaining('using G55') });
    expect(sim.state().wcs).toBe('G54');
    expect(useLaserStore.getState().activeWcs).toBe('G54');
  });

  it('reads the G54 an M30 restored and writes nothing', async () => {
    const sim = await connectGrbl();
    await startOpenedProgram('G21 G90\nG55\nG0 X5 Y5\nM30\n');
    await finishRun();
    expect(sim.state().wcs).toBe('G54');
    expect(useLaserStore.getState().activeWcs).toBeNull();

    await expect(settle(normalizeFrameWorkCoordinateSystem())).resolves.toEqual({ ok: true });
    expect(useLaserStore.getState().activeWcs).toBe('G54');
    expect(useLaserStore.getState().log.join('\n')).not.toContain('Frame selected G54');
  });

  it('keeps the known G54 for a program that only selects G54', async () => {
    await connectGrbl();
    await startOpenedProgram('G90 G94 G17 G21 G54\nG0 X5 Y5\nG1 X10 Y5 F600\nM30\n');
    await finishRun();
    expect(useLaserStore.getState().activeWcs).toBe('G54');
  });
});

describe('E4-P2-1: probed Work Z after an opened CNC program', () => {
  function workZCurrent(): boolean {
    const laser = useLaserStore.getState();
    return isWorkZEvidenceCurrentForStart(
      laser.workZZeroEvidence,
      laser.workZReferenceEpoch,
      laser.controllerSessionEpoch,
    );
  }

  async function connectZeroedCnc(): Promise<void> {
    useStore.setState({
      project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    await connectGrbl();
    await settle(useLaserStore.getState().zeroZHere());
    expect(workZCurrent()).toBe(true);
  }

  it.each(['G92 Z0', 'G10 L20 P0 Z0', 'G43.1 Z2', 'T2'])(
    'is stale after a program with %s',
    async (line) => {
      await connectZeroedCnc();
      await startOpenedProgram(`G21 G90 G54\n${line}\nG0 X5 Y5\nM30\n`);
      await finishRun();
      expect(workZCurrent()).toBe(false);
      expect(useLaserStore.getState().log.join('\n')).toContain(
        'Work Z set before it no longer applies',
      );
    },
  );

  it('stays current after a program that changes no Z offset or tool', async () => {
    await connectZeroedCnc();
    await startOpenedProgram('G21 G90 G54\nG0 X5 Y5\nG1 X10 Y5 F600\nM30\n');
    await finishRun();
    expect(workZCurrent()).toBe(true);
  });
});
