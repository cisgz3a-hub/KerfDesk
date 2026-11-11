// Annoyance audit A3-P2-4, ADR-674 Amendment 1: a Console command that can
// change the machine makes the store forget the last status report, and the
// idle poll asks only once a second, so Send and the jog pad stayed off for up
// to a second after every line. One status query now goes out as soon as the
// controller has answered the command.
//
// The clock is faked and every test starts just after an idle poll, so the
// background poll cannot write a status query inside a test's own window.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectControllerDriver } from '../../core/controllers';
import { consoleCommandDisabledReason } from '../laser/console/console-command-availability';
import { jogPadBlockReason } from '../laser/control-block-reason';
import { startMotionOperation } from './laser-motion-operation';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from './laser-store-motion-operation.test-support';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
const STATUS_QUERY = '?';

let writes: string[] = [];
let connection: FakeConnection;

async function drain(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

function statusQueries(): number {
  return writes.filter((write) => write === STATUS_QUERY).length;
}

function sendBlockReason(): string | null {
  const state = useLaserStore.getState();
  const driver = selectControllerDriver(state.activeControllerKind);
  return consoleCommandDisabledReason(driver, 'G0 X2', state);
}

// Runs the clock to the next idle poll, answers it, and leaves a full second
// before the poll asks again.
async function settleJustAfterIdlePoll(): Promise<void> {
  const before = statusQueries();
  for (let step = 0; step < 300 && statusQueries() === before; step += 1) {
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(statusQueries()).toBe(before + 1);
  connection.emitLine(IDLE);
  await drain();
}

// A Console line the controller has been sent but has not answered yet.
async function sendUnansweredLine(): Promise<void> {
  await useLaserStore.getState().sendConsoleCommand('G0 X1');
  expect(writes).toContain('G0 X1\n');
  writes.length = 0;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  writes = [];
  connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  await drain();
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  await settleJustAfterIdlePoll();
});

afterEach(async () => {
  // Disconnect waits on real time.
  vi.useRealTimers();
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

describe('status query after a Console command', () => {
  it('asks for a report as soon as the command is answered', async () => {
    await sendUnansweredLine();
    // The rule itself is unchanged: the old report is gone until a new one.
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(sendBlockReason()).not.toBeNull();
    expect(jogPadBlockReason(useLaserStore.getState())).not.toBeNull();

    // Not before the reply: a status byte is answered ahead of the line queue.
    await vi.advanceTimersByTimeAsync(100);
    expect(statusQueries()).toBe(0);

    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(20);
    expect(statusQueries()).toBe(1);

    connection.emitLine(IDLE);
    await drain();
    expect(sendBlockReason()).toBeNull();
    expect(jogPadBlockReason(useLaserStore.getState())).toBeNull();
    // One query, not a burst.
    await vi.advanceTimersByTimeAsync(100);
    expect(statusQueries()).toBe(1);
  });

  it('sends nothing when a report arrived on its own first', async () => {
    await sendUnansweredLine();
    connection.emitLine('ok');
    connection.emitLine(IDLE);
    await vi.advanceTimersByTimeAsync(100);
    expect(statusQueries()).toBe(0);
  });

  it('stays out of a jog or Frame, which is polled four times a second already', async () => {
    await sendUnansweredLine();
    useLaserStore.setState({
      motionOperation: startMotionOperation('jog', [], undefined, 0, 0, undefined, 'G4 P0.01\n'),
    });
    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(100);
    expect(statusQueries()).toBe(0);
  });

  it('gives up after the idle poll period when the command is never answered', async () => {
    await sendUnansweredLine();
    await vi.advanceTimersByTimeAsync(900);
    expect(statusQueries()).toBe(0);
  });

  it('does not follow a read-only command, which forgets no report', async () => {
    writes.length = 0;
    await useLaserStore.getState().sendConsoleCommand('$#');
    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(100);
    expect(useLaserStore.getState().statusReport).not.toBeNull();
    expect(statusQueries()).toBe(0);
  });
});
