// Controller audit gap-start-1: the final Laser Start status query required a
// realtime `?`, which Marlin does not have, so every Frame-authorized laser
// Start on Marlin was refused after the Frame had run. A queued-poll
// controller now gets an owned M400 fence and an owned M114 instead.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import type { FramedRunCandidate, FramedRunPermit } from './framed-run';
import { framedRunControllerSnapshot } from './framed-run';
import {
  captureLaserModeStartSnapshot,
  createLaserModeStartEvidence,
} from './laser-mode-start-evidence';
import { useLaserStore } from './laser-store';
import { disconnectOnTestClock } from './laser-disconnect-testing';

const JOB_LINE = 'G1 X10.000 Y5.000 F600 S255';
const JOB_GCODE = `G21\nG90\n${JOB_LINE}\nM5\n`;
const POSITION = 'X:31.00 Y:42.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0';

type FakeMarlin = SerialConnection & { readonly emitLine: (line: string) => void };

// Marlin answers every queued line with `ok`; M114 first reports the position.
function fakeMarlin(writes: string[]): FakeMarlin {
  const handlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of [...handlers]) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      for (const line of data.split('\n').filter((part) => part.trim() !== '')) {
        setTimeout(() => {
          if (line === 'M114') emitLine(POSITION);
          emitLine('ok');
        }, 0);
      }
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
  };
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function settle(ms = 20): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

function installPermit() {
  const sessionEpoch = useLaserStore.getState().controllerSessionEpoch;
  useLaserStore.setState({
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch, observedAt: 1 },
  });
  const state = useLaserStore.getState();
  const permit: FramedRunPermit = {
    kind: 'ready',
    candidate: {} as FramedRunCandidate,
    completedStatusSequence: state.statusSequence,
    controller: framedRunControllerSnapshot(state),
  };
  useLaserStore.setState({
    framedRun: permit,
    frameVerification: { boundsSignature: 'fresh-start', wco: null, workOriginActive: false },
  });
  // Marlin reports no $30/$32, so Job Review's acknowledgement stands in.
  const evidence = createLaserModeStartEvidence(
    captureLaserModeStartSnapshot(state),
    1000,
    false,
    true,
  );
  return { permit, evidence };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  vi.restoreAllMocks();
});

describe('Frame-authorized laser Start on Marlin', () => {
  it('fences with M400, confirms Idle with M114, then streams the job', async () => {
    const writes: string[] = [];
    const connection = fakeMarlin(writes);
    await useLaserStore
      .getState()
      .connect(adapterFor(connection), { controllerKind: 'marlin', baudRate: 250000 });
    connection.emitLine('start');
    await settle(400);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    const { permit, evidence } = installPermit();
    writes.length = 0;
    await useLaserStore.getState().startJob(JOB_GCODE, {
      machineKind: 'laser',
      framedRunPermit: permit,
      laserModeStartEvidence: evidence,
    });
    await settle();

    expect(useLaserStore.getState().lastWriteError ?? '').not.toContain('Laser Start');
    const fence = writes.indexOf('M400\n');
    const query = writes.indexOf('M114\n');
    expect(fence).toBeGreaterThanOrEqual(0);
    expect(query).toBeGreaterThan(fence);
    expect(writes.slice(query + 1).join('')).toContain(JOB_LINE);
    // Marlin has no realtime overrides, so the ADR-355 reset never reaches it:
    // a 0x90-0x9D byte would land in its line buffer.
    expect(writes.join('')).not.toMatch(/[\u0080-\u00ff]/);
  });
});
