// Protocol audit P-3, ADR-672: step presses join a running operator step jog
// on a GRBL-family controller, up to three steps, and each queued step waits
// in KerfDesk until the one before it settles. Cancel's 0x85 then stops the
// running step and no queued step is ever written.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marlinDriver } from '../../core/controllers';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { startMotionOperation } from './laser-motion-operation';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  getMotionOperation,
  makeConnection,
  type FakeConnection,
} from './laser-store-motion-operation.test-support';
import {
  appendStepJog,
  canQueueStepJog,
  MAX_STEP_JOGS_PER_OPERATION,
  outstandingStepJogs,
} from './step-jog-queue';

const SETTLE = 'G4 P0.01\n';
const IDLE = '<Idle|MPos:100.000,100.000,0.000|FS:0,0>';
const JOG = '<Jog|MPos:100.500,100.000,0.000|FS:1000,0>';
const STEP = { queueStep: true } as const;

describe('appendStepJog', () => {
  it('queues the step ahead of the planner-drain marker', () => {
    const operation = startMotionOperation('jog', [SETTLE], undefined, 0, 0, undefined, SETTLE);
    const next = appendStepJog(operation, '$J=X2\n', null);
    expect(next.pendingLines).toEqual(['$J=X2\n', SETTLE]);
    expect(outstandingStepJogs(next)).toBe(2);
  });

  it('sends the marker again when it was already out', () => {
    const operation = {
      ...startMotionOperation('jog', [], undefined, 0, 0, undefined, SETTLE),
      awaitingSettlementAck: true,
    };
    expect(outstandingStepJogs(operation)).toBe(0);
    expect(appendStepJog(operation, '$J=X2\n', null).pendingLines).toEqual(['$J=X2\n', SETTLE]);
  });
});

let writes: string[] = [];
let connection: FakeConnection;

async function drain(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

function jogLines(): string[] {
  return writes.filter((write) => write.startsWith('$J='));
}

async function settleStep(): Promise<void> {
  connection.emitLine('ok');
  connection.emitLine(JOG);
  await drain();
  connection.emitLine(IDLE);
  await drain();
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  writes = [];
  connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
  connection.emitLine(IDLE);
  await drain();
  writes.length = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    lastWriteError: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('queued step jogs on GRBL', () => {
  it('runs three quick presses as three steps, one after another', async () => {
    const { jog } = useLaserStore.getState();
    await jog({ dx: 1, feed: 1000 }, undefined, STEP);
    connection.emitLine(JOG);
    await drain();
    await jog({ dx: 2, feed: 1000 }, undefined, STEP);
    await jog({ dx: 3, feed: 1000 }, undefined, STEP);
    // Queued steps wait in KerfDesk, not in the controller's buffer.
    expect(jogLines()).toEqual(['$J=G91 G21 X1.000 F1000\n']);
    expect(outstandingStepJogs(getMotionOperation()!)).toBe(MAX_STEP_JOGS_PER_OPERATION);
    expect(canQueueStepJog(useLaserStore.getState())).toBe(false);
    await expect(jog({ dx: 4, feed: 1000 }, undefined, STEP)).rejects.toThrow();

    await settleStep();
    expect(jogLines()).toHaveLength(2);
    await settleStep();
    expect(jogLines()).toEqual([
      '$J=G91 G21 X1.000 F1000\n',
      '$J=G91 G21 X2.000 F1000\n',
      '$J=G91 G21 X3.000 F1000\n',
    ]);
    await settleStep();
    expect(writes).toContain(SETTLE);
    connection.emitLine('ok');
    await drain();
    connection.emitLine(IDLE);
    await drain();
    expect(getMotionOperation()).toBeNull();
  });

  it('Cancel sends 0x85 and never writes a queued step', async () => {
    const { jog } = useLaserStore.getState();
    await jog({ dx: 1, feed: 1000 }, undefined, STEP);
    connection.emitLine('ok');
    connection.emitLine(JOG);
    await drain();
    await jog({ dx: 2, feed: 1000 }, undefined, STEP);
    await jog({ dx: 3, feed: 1000 }, undefined, STEP);

    void useLaserStore
      .getState()
      .cancelJog()
      .catch(() => undefined);
    await drain();
    expect(writes).toContain(RT_JOG_CANCEL);
    for (let round = 0; round < 3; round += 1) {
      connection.emitLine('ok');
      connection.emitLine(IDLE);
      await drain();
    }
    expect(jogLines()).toEqual(['$J=G91 G21 X1.000 F1000\n']);
  });

  it('starts no queue for a press-and-hold or an owned jog', async () => {
    await useLaserStore.getState().jog({ dx: 300, feed: 3000 });
    expect(getMotionOperation()?.stepJogQueue).toBeUndefined();
    expect(canQueueStepJog(useLaserStore.getState())).toBe(false);
  });

  it('does not queue on a controller without a native jog', async () => {
    await useLaserStore.getState().jog({ dx: 1, feed: 1000 }, undefined, STEP);
    connection.emitLine(JOG);
    await drain();
    useLaserStore.setState({ capabilities: marlinDriver.capabilities });
    expect(canQueueStepJog(useLaserStore.getState())).toBe(false);
  });
});
