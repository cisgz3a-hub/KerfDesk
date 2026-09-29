// Controller audit 2 (ADR-375), C-5: GRBL answers lines strictly in order
// (grbl/protocol.c#L88-L104), and an owned Console exchange takes the next
// terminal reply as its own. A `$$` or `$n=` sent while an earlier Console line
// still owes its ok would take that ok, so it waits instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  flushConnect,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';

async function connectedIdle(): Promise<{ connection: FakeConnection; wire: string[] }> {
  const wire: string[] = [];
  const connection = makeConnection(
    async (data) => {
      wire.push(data);
    },
    { autoRespondToStatusQuery: true },
  );
  await connectWith(connection);
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushConnect();
  wire.length = 0;
  return { connection, wire };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerOperation: null,
    lastWriteError: null,
    log: [],
    transcript: [],
  });
  vi.restoreAllMocks();
});

describe('owned Console exchanges wait for earlier acknowledgements', () => {
  it('refuses $$ while a Console $H still owes its ok', async () => {
    const { connection, wire } = await connectedIdle();
    await useLaserStore.getState().sendConsoleCommand('$H');
    connection.emitLine('<Home|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();

    await expect(useLaserStore.getState().sendConsoleCommand('$$')).rejects.toThrow(
      'Wait for the previous controller write and acknowledgement before reading controller settings.',
    );
    expect(wire.filter((line) => line !== '?')).toEqual(['$H\n']);
  });

  it('refuses a setting write while a Console dwell still owes its ok', async () => {
    const { connection, wire } = await connectedIdle();
    await useLaserStore.getState().sendConsoleCommand('G4 P3');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    await expect(
      useLaserStore.getState().sendConsoleCommand('$30=1000', { confirmed: true }),
    ).rejects.toThrow(
      'Wait for the previous controller write and acknowledgement before writing a controller setting.',
    );
    expect(wire.filter((line) => line !== '?')).toEqual(['G4 P3\n']);

    connection.emitLine('ok');
    await flushConnect();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('keeps $X available as recovery while an earlier line owes its ok', async () => {
    const { connection, wire } = await connectedIdle();
    await useLaserStore.getState().sendConsoleCommand('G4 P3');

    const unlock = useLaserStore.getState().sendConsoleCommand('$X');
    await vi.waitFor(() => expect(wire).toContain('$X\n'));
    connection.emitLine('ok');
    connection.emitLine('ok');
    await unlock;
  });
});
