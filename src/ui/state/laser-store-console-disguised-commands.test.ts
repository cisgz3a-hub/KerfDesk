// Meta audit v1 M6-P2-1 (ADR-375 Amendment 6): through the real Console store,
// `(x)$30=255` reached stock GRBL as `$30=255` with no confirmation, value
// check or `$$` re-read, so Start kept a power scale of 1000 while every layer
// above 25.5 % burned at full power; `$RST(x)=*` wiped the EEPROM and
// `$N(x)0=G0X100` installed a startup move. Each one is now refused before a
// byte is written, on stock GRBL and on grblHAL, even with confirmation given.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  flushConnect,
  makeAdapter,
  makeConnection,
} from './laser-store-console.test-support';

const DISGUISED_COMMANDS = [
  '(x)$30=255',
  '$30(x)=255',
  '$RST(x)=*',
  '$N(x)0=G0X100',
  '$22(x)=0.5',
  '$I(x)=x',
];

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
    grblSettingsRows: [],
  });
  vi.restoreAllMocks();
});

async function connectedIdle(controllerKind: 'grbl-v1.1' | 'grblhal'): Promise<string[]> {
  const wire: string[] = [];
  const connection = makeConnection(
    async (data) => {
      wire.push(data);
    },
    { autoRespondToStatusQuery: true },
  );
  if (controllerKind === 'grbl-v1.1') {
    await connectWith(connection);
  } else {
    await useLaserStore.getState().connect(makeAdapter(connection), { controllerKind });
    connection.emitLine("GrblHAL 1.1f ['$' or '$HELP' for help]");
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    connection.emitLine('ok');
    await flushConnect();
  }
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushConnect();
  wire.length = 0;
  return wire;
}

describe.each(['grbl-v1.1', 'grblhal'] as const)(
  'Console $ commands disguised by a comment on %s',
  (controllerKind) => {
    it.each(DISGUISED_COMMANDS)('refuses %j before writing anything', async (command) => {
      const wire = await connectedIdle(controllerKind);

      await expect(
        useLaserStore.getState().sendConsoleCommand(command, { confirmed: true }),
      ).rejects.toThrow();
      expect(wire.filter((data) => data !== '?')).toEqual([]);
    });
  },
);
