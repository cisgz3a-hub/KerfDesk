// A line the serial wire cannot carry (audit transport-1). Both transports
// encode one byte per character and refuse a character above U+00FF before a
// single byte is written (src/platform/web/serial-wire.ts), so the controller
// never sees the line and no `ok` or `error:` can ever answer it (GRBL answers
// each line it RECEIVES: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface).
// safeWrite used to reserve that line's acknowledgement first and keep it as
// an "ambiguous" quarantine, so Jog, Frame and Start stayed fenced until a
// reset or reconnect. The fake transport below encodes exactly as production
// does, so the wire it records is the oracle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWireBytes } from '../../platform/web/serial-wire';
import { grblDriver } from '../../core/controllers';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  flushConnect,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';
import { hasPendingControllerWrite } from './laser-start-queue-fence';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';

async function connectedIdle(): Promise<{ connection: FakeConnection; wire: string[] }> {
  const wire: string[] = [];
  const connection = makeConnection(
    async (data) => {
      wire.push(String.fromCharCode(...encodeWireBytes(data)));
    },
    { autoRespondToStatusQuery: true },
  );
  await connectWith(connection);
  connection.emitLine(IDLE);
  await flushConnect();
  return { connection, wire };
}

function ledger() {
  const state = useLaserStore.getState();
  return {
    pendingUntrackedAcks: state.pendingUntrackedAcks,
    pendingTransportWrites: state.pendingTransportWrites ?? 0,
    startFenced: hasPendingControllerWrite(state),
    safetyNotice: state.safetyNotice,
  };
}

const SETTLED = {
  pendingUntrackedAcks: 0,
  pendingTransportWrites: 0,
  startFenced: false,
  safetyNotice: null,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

// The Console now refuses such a line even earlier, in the driver's preparer
// (audit transport-2); the ledger guarantees below are the same either way.
describe('a line the wire cannot carry (audit transport-1)', () => {
  it('refuses it with nothing sent, nothing owed, and no E-stop notice', async () => {
    const { wire } = await connectedIdle();
    const sentBefore = wire.length;
    expect(ledger()).toEqual(SETTLED);

    await expect(
      useLaserStore.getState().sendConsoleCommand('G4 P0 (dwell — none)'),
    ).rejects.toThrow(/plain ASCII.*"—".*U\+2014/i);
    await flushConnect();

    expect(wire.slice(sentBefore)).toEqual([]);
    expect(ledger()).toEqual(SETTLED);
    expect(useLaserStore.getState().lastWriteError).toMatch(/plain ASCII/);
  });

  it('leaves the acknowledgement ledger in step: the next line and its ok settle it', async () => {
    const { connection, wire } = await connectedIdle();
    await expect(
      useLaserStore.getState().sendConsoleCommand('G0 X1 (nudge → right)'),
    ).rejects.toThrow(/plain ASCII/i);

    await useLaserStore.getState().sendConsoleCommand('G4 P0');
    await flushConnect();
    expect(wire).toContain('G4 P0\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    connection.emitLine('ok');
    await flushConnect();

    expect(ledger()).toEqual(SETTLED);
  });

  it('does not leave Jog fenced behind an acknowledgement that can never come', async () => {
    const { connection, wire } = await connectedIdle();
    await expect(
      useLaserStore.getState().sendConsoleCommand('G4 P0 (wait — none)'),
    ).rejects.toThrow(/plain ASCII/i);

    await expect(useLaserStore.getState().jog({ dx: 1, feed: 500 })).resolves.toBeUndefined();

    expect(wire.filter((line) => line.startsWith('$J='))).toHaveLength(1);
    connection.emitLine('ok');
    await flushConnect();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});

// Every writer, not only the Console, goes through safeWrite, so it refuses an
// unsendable line itself before it owes anything: a character with no single
// byte (transport-1) or a byte above 0x7F inside a queued line, which GRBL
// would run as a realtime command (transport-2).
describe('safeWrite backstop for writers that skip the Console', () => {
  it.each([
    ['a character with no single byte', 'G4 P0 (dwell \u2014 none)\n', 0x2014],
    ['a realtime byte inside a queued line', 'G0\xA0X1\n', 0xa0],
  ])('refuses %s with nothing written and nothing owed', async (_name, line, codePoint) => {
    const written: string[] = [];
    const refs: SafeWriteRefs = {
      connection: {
        write: async (data) => {
          written.push(data);
        },
        onLine: () => () => undefined,
        onClose: () => () => undefined,
        close: async () => undefined,
      },
      driver: grblDriver,
      nextTranscriptId: 1,
      writeEpoch: 0,
    };
    useLaserStore.setState({ pendingTransportWrites: 0, pendingUntrackedAcks: 0 });
    const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, refs);

    await expect(write(line)).rejects.toMatchObject({ name: 'WireEncodingError', codePoint });

    expect(written).toEqual([]);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().pendingTransportWrites ?? 0).toBe(0);
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });
});
