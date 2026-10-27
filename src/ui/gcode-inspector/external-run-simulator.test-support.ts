// The real store, the real external Frame and Start, and the GRBL simulator, on
// the fake clock: shared by the external-run simulator suites.

import { expect, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { externalProgramBaseline, normalizeExternalProgram } from '../../core/external-program';
import { kerfDeskBitFile } from '../../core/external-program/kerfdesk-bit-file';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { frameExternalProgram, startExternalProgram, type ExternalRun } from './external-run';

const ENVELOPE = { minX: 0, minY: 0, maxX: 10, maxY: 5 };

/** Disconnects and returns both stores to a fresh GRBL session. */
export async function resetExternalRunStores(): Promise<void> {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
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
    activeWcs: null,
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
    workZZeroEvidence: null,
    positionEvidenceSuppressed: false,
  });
  resetStore();
}

/** Advances the test clock until `promise` settles. */
export async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  for (let tick = 0; tick < 3_000 && !done; tick += 1) await vi.advanceTimersByTimeAsync(10);
  return tracked;
}

export async function connectGrbl(): Promise<GrblSimulator> {
  const sim = createGrblSimulator({ motionMs: 25 });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'grbl-v1.1' });
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  expect(useLaserStore.getState().activeWcs).toBe('G54');
  return sim;
}

/** The run the Run dialog prepares for `file`, read from where the head stands, its
 * per-bit header included. */
export function openedProgram(file: string): ExternalRun {
  const normalized = normalizeExternalProgram(
    file,
    externalProgramBaseline('grbl-v1.1'),
    'grbl-v1.1',
  );
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  const bitFile = kerfDeskBitFile(file);
  return {
    controllerKind: 'grbl-v1.1',
    name: 'part.nc',
    gcode: normalized.program.gcode,
    envelope: ENVELOPE,
    start: liveStart(),
    ...(bitFile === null ? {} : { bitFile }),
  };
}

/** Frames and starts `file`, and returns once the stream is installed. */
export async function startOpenedProgram(file: string): Promise<void> {
  const frame = await settle(frameExternalProgram(openedProgram(file)));
  if (frame === null) throw new Error('the external Frame did not complete');
  await expect(settle(startExternalProgram(frame))).resolves.toBe(true);
}

export async function finishRun(): Promise<void> {
  for (let tick = 0; tick < 3_000 && useLaserStore.getState().streamer !== null; tick += 1) {
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(useLaserStore.getState().streamer).toBeNull();
}

function liveStart(): ExternalRun['start'] {
  const laser = useLaserStore.getState();
  const here = reportedWorkPositionMm(laser, laser.controllerSettings?.reportInches === true);
  return here === null ? { x: 0, y: 0, z: 0 } : { x: here.x, y: here.y, z: here.z };
}
