import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from './laser-store-motion-operation.test-support';
import { useStore } from './store';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

const RETRACT = '$J=G90 G21 Z3.810 F1000\n';
const MARKER = 'G4 P0.01\n';
const IDLE = '<Idle|MPos:50.000,30.000,3.810|FS:0,0|MPG:0>';
const MPG_IDLE = '<Idle|MPos:50.000,30.000,3.810|FS:0,0|MPG:1>';
const RELEASED_JOG = '<Jog|MPos:55.000,35.000,3.810|FS:1000,0|MPG:0>';

async function flush(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

async function prepareCnc(connection: FakeConnection, writes: string[]): Promise<void> {
  await connectWith(connection);
  useStore.getState().setMachineKind('cnc');
  const state = useLaserStore.getState();
  useLaserStore.setState({
    workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', state.workZReferenceEpoch),
  });
  connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0|MPG:0>');
  writes.length = 0;
}

async function settleRecovery(connection: FakeConnection): Promise<void> {
  connection.emitLine(IDLE);
  await flush();
  connection.emitLine('ok');
  await flush();
  connection.emitLine(IDLE);
  await flush();
  expect(useLaserStore.getState().motionOperation).toBeNull();
  expect(useLaserStore.getState().framedRun).toBeNull();
}

afterEach(async () => {
  useStore.getState().setMachineKind('laser');
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('CNC point-move interruption remains permanent after MPG release', () => {
  it('never resumes the original XY after a delayed safe-Z handoff crosses takeover and release', async () => {
    const writes: string[] = [];
    let releaseRetract!: () => void;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === RETRACT) {
        await new Promise<void>((resolve) => {
          releaseRetract = resolve;
        });
      }
    });
    await prepareCnc(connection, writes);
    const outcome = useLaserStore
      .getState()
      .jogToMachinePosition(120, 80, 1000)
      .catch((error: unknown) => error);
    await flush();
    connection.emitLine('ok');
    // The controller completed Z and yielded control before the adapter's
    // promise resolved. Releasing MPG must not revive this old point move.
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_JOG);
    releaseRetract();
    await flush();

    expect(writes).toEqual([RETRACT]);
    expect(await outcome).toBeInstanceOf(Error);
    await settleRecovery(connection);
    expect(writes).toEqual([RETRACT, MARKER]);
  });

  it('rejects the old safe-Z status continuation even when MPG releases before it resumes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await prepareCnc(connection, writes);
    const outcome = useLaserStore
      .getState()
      .jogToMachinePosition(120, 80, 1000)
      .catch((error: unknown) => error);
    await flush();
    connection.emitLine('ok');
    await vi.waitFor(() => expect(writes).toEqual([RETRACT, '?']));
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_JOG);
    await flush();

    expect(writes).toEqual([RETRACT, '?']);
    expect(await outcome).toBeInstanceOf(Error);
    await settleRecovery(connection);
    expect(writes).toEqual([RETRACT, '?', MARKER]);
  });

  it('does not revive XY when the old safe-Z marker acknowledges before its delayed handoff', async () => {
    const writes: string[] = [];
    let releaseMarker!: () => void;
    let delayMarker = true;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === MARKER && delayMarker) {
        delayMarker = false;
        await new Promise<void>((resolve) => {
          releaseMarker = resolve;
        });
      }
    });
    await prepareCnc(connection, writes);
    const outcome = useLaserStore
      .getState()
      .jogToMachinePosition(120, 80, 1000)
      .catch((error: unknown) => error);
    await flush();
    connection.emitLine('ok');
    await vi.waitFor(() => expect(writes).toEqual([RETRACT, '?']));
    connection.emitLine(IDLE);
    await vi.waitFor(() => expect(writes).toEqual([RETRACT, '?', MARKER]));
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_JOG);
    connection.emitLine('ok');
    releaseMarker();
    await flush();

    expect(writes).toEqual([RETRACT, '?', MARKER]);
    expect(await outcome).toBeInstanceOf(Error);
    await settleRecovery(connection);
    expect(writes).toEqual([RETRACT, '?', MARKER, MARKER]);
  });
});
