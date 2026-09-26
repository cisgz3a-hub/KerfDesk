// What a Console command leaves behind once the controller acknowledged it
// (controller audit 2026-09-23). Each case is driven through the real store
// over a fake GRBL session; the oracles are the controller's reply and the
// state an operator relies on afterwards (the marker that stops polling and
// refuses Jog/Frame/Start, the alarm latch that refuses Start and Fire, and the
// machine position the DRO shows).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  flushConnect,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';
import { EMPTY_SETTINGS_RESPONSE_MESSAGE } from './laser-console-completion';

const IDLE = '<Idle|MPos:1.000,2.000,0.000|FS:0,0|Ov:100,100,100>';

async function connectedIdle(): Promise<{ connection: FakeConnection; wire: string[] }> {
  const wire: string[] = [];
  const connection = makeConnection(
    async (data) => {
      wire.push(data);
    },
    { autoRespondToStatusQuery: true },
  );
  await connectWith(connection);
  connection.emitLine(IDLE);
  await flushConnect();
  return { connection, wire };
}

/** Sends a console command and answers its line once it reaches the wire. */
async function sendAndAnswer(
  connection: FakeConnection,
  wire: string[],
  command: string,
  reply: ReadonlyArray<string>,
  options: { readonly confirmed?: boolean } = {},
): Promise<void> {
  const sent = useLaserStore.getState().sendConsoleCommand(command, options);
  await vi.waitFor(() =>
    expect(wire.some((line) => line.endsWith('\n') && line.trim() !== '?')).toBe(true),
  );
  for (const line of reply) connection.emitLine(line);
  await sent;
  await flushConnect();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ alarmCode: null, controllerOperation: null, lastWriteError: null });
  vi.restoreAllMocks();
});

describe('Console command completion', () => {
  it('releases the settings marker when $$ is answered by a bare ok', async () => {
    const { connection, wire } = await connectedIdle();
    wire.length = 0;

    await sendAndAnswer(connection, wire, '$$', ['ok']);

    expect(wire).toContain('$$\n');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().log.at(-1)).toContain(EMPTY_SETTINGS_RESPONSE_MESSAGE);
  });

  // The acknowledgement alone does not prove the unlock: FluidNC acks `$X` in
  // its Critical state (controller audit 2026-09-25 HF-2). The next report that
  // is not Alarm clears the latch.
  it('clears the alarm latch once the controller reports Idle after acknowledging $X', async () => {
    const { connection, wire } = await connectedIdle();
    useLaserStore.setState({ alarmCode: 5 });
    wire.length = 0;

    await sendAndAnswer(connection, wire, '$X', ['[MSG:Caution: Unlocked]', 'ok']);

    expect(wire).toContain('$X\n');
    expect(useLaserStore.getState().alarmCode).toBe(5);
    connection.emitLine(IDLE);
    await flushConnect();
    expect(useLaserStore.getState().alarmCode).toBeNull();
  });

  it('keeps the alarm latch when the controller refuses $X', async () => {
    const { connection, wire } = await connectedIdle();
    useLaserStore.setState({ alarmCode: 5 });
    wire.length = 0;

    await expect(sendAndAnswer(connection, wire, '$X', ['error:9'])).rejects.toThrow();

    expect(useLaserStore.getState().alarmCode).toBe(5);
  });

  it('re-reads the settings after a $13 write so machine position shows again', async () => {
    const { connection, wire } = await connectedIdle();
    wire.length = 0;

    const sent = useLaserStore.getState().sendConsoleCommand('$13=0', { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain('$13=0\n'));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(wire).toContain('$$\n'));
    expect(useLaserStore.getState().reportUnitsUnconfirmed).toBe(true);
    for (const line of ['$13=0', '$110=6000', '$111=6000', '$130=400', '$131=400', 'ok']) {
      connection.emitLine(line);
    }
    await sent;

    expect(useLaserStore.getState().reportUnitsUnconfirmed).toBe(false);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('does not report a refused setting write as done', async () => {
    const { connection, wire } = await connectedIdle();
    wire.length = 0;

    const sent = useLaserStore.getState().sendConsoleCommand('$13=0', { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain('$13=0\n'));
    connection.emitLine('error:3');

    await expect(sent).rejects.toThrow();
    expect(wire).not.toContain('$$\n');
  });
});

// Moved from laser-store-console.test.ts: a confirmed setting write is now an
// owned exchange that settles on the controller's ok (regressions-1), so the
// test answers it. The fresh-Idle check behind it waits for the next
// background status poll when the fake transport answers `?` first, hence
// the longer waits.
describe('Console setting writes', () => {
  it('requires confirmation and Idle state while preserving position for non-positional settings', async () => {
    const writes: string[] = [];
    const connection = makeConnection(
      async (data) => {
        writes.push(data);
      },
      { autoRespondToStatusQuery: true },
    );
    await connectWith(connection);
    writes.length = 0;
    useLaserStore.setState({ statusReport: null, statusObservation: null });

    await expect(useLaserStore.getState().sendConsoleCommand('$32=1')).rejects.toThrow(
      /confirmation/i,
    );
    // A confirmed setting write is an owned exchange that settles on the
    // controller's ok (audit regressions-1), so answer it while it is pending.
    const settingWrite = useLaserStore.getState().sendConsoleCommand('$32=1', { confirmed: true });
    await vi.waitFor(() => expect(writes).toContain('$32=1\n'), { timeout: 4000 });
    connection.emitLine('ok');
    await settingWrite;
    expect(writes.slice(-2)).toEqual(['?', '$32=1\n']);
    await flushConnect();
    writes.length = 0;

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    useLaserStore.setState({
      controllerSettings: { laserModeEnabled: true },
      detectedSettings: { laserModeEnabled: true },
      grblSettingsRows: [
        {
          id: 32,
          code: '$32',
          rawValue: '1',
          numericValue: 1,
          name: 'Laser mode',
          unit: null,
          description: 'Laser mode enable',
          category: 'laser',
          known: true,
          writeRisk: 'common',
        },
      ],
      lastSettingsReadAt: 123,
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: currentWorkZEvidence(),
      wcoCache: { x: 1, y: 2, z: 3 },
      homingState: 'confirmed',
    });
    const secondWrite = useLaserStore.getState().sendConsoleCommand('$32=1', { confirmed: true });
    await vi.waitFor(() => expect(writes).toContain('$32=1\n'), { timeout: 4000 });
    connection.emitLine('ok');
    await secondWrite;

    expect(writes.at(-1)).toBe('$32=1\n');
    expect(useLaserStore.getState()).toMatchObject({
      controllerSettings: null,
      detectedSettings: null,
      grblSettingsRows: [],
      lastSettingsReadAt: null,
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: currentWorkZEvidence(),
      wcoCache: { x: 1, y: 2, z: 3 },
      homingState: 'confirmed',
      statusReport: null,
    });
  });
});

function currentWorkZEvidence() {
  return {
    source: 'manual-zero' as const,
    referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
  };
}
