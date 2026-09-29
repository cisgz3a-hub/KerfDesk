// Controller audit 2 (ADR-375), C-4: a Console `$n=` write on stock GRBL. The
// firmware truncates an integer setting's value into 8 bits and still answers
// `ok` (grbl/settings.c#L229), so such a value is refused before anything is
// written, and every acknowledged write is read back with `$$` so the settings
// table shows what the controller actually stored.
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
    grblSettingsRows: [],
  });
  vi.restoreAllMocks();
});

describe('Console setting writes on stock GRBL', () => {
  it.each([
    ['$22=0.5', /0\.5 would turn it off/],
    ['$1=300', /whole number from 0 to 255/],
  ])('refuses %s before writing anything', async (command, reason) => {
    const { wire } = await connectedIdle();

    await expect(
      useLaserStore.getState().sendConsoleCommand(command, { confirmed: true }),
    ).rejects.toThrow(reason);
    expect(wire.filter((data) => data !== '?')).toEqual([]);
  });

  it('reads the settings back after an acknowledged write', async () => {
    const { connection, wire } = await connectedIdle();

    const sent = useLaserStore.getState().sendConsoleCommand('$1=25', { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain('$1=25\n'));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(wire).toContain('$$\n'));
    for (const line of ['$1=25', '$22=1', 'ok']) connection.emitLine(line);
    await sent;

    const rows = useLaserStore.getState().grblSettingsRows;
    expect(rows.find((row) => row.id === 1)?.rawValue).toBe('25');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('keeps an acknowledged write and says so when the read-back fails', async () => {
    const { connection, wire } = await connectedIdle();

    const sent = useLaserStore.getState().sendConsoleCommand('$1=25', { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain('$1=25\n'));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(wire).toContain('$$\n'));
    connection.emitLine('error:8');
    await sent;

    expect(useLaserStore.getState().log.join('\n')).toContain(
      'The controller acknowledged $1=25, but reading its settings back failed',
    );
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });
});
