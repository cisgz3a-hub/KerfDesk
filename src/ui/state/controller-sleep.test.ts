// Controller audit drivers-4: grblHAL answers `$SLP` with error:3 unless its
// `$62` Sleep enable setting is on. Release motors is disabled when a `$$`
// read reported `$62=0`, and a refused `$SLP` leaves the origin and position
// evidence alone instead of voiding them behind a controller-error notice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { settingsMapToRows } from '../../core/controllers/grbl';
import {
  GRBLHAL_SLEEP_DISABLED_MESSAGE,
  NO_SLEEP_COMMAND_MESSAGE,
  sleepRefusalMessage,
  sleepUnavailableReason,
} from './controller-sleep';
import { useLaserStore } from './laser-store';
import { connectWith, flushConnect, makeConnection } from './laser-store-console.test-support';

function rows(entries: ReadonlyArray<readonly [number, string]>) {
  return settingsMapToRows(new Map(entries));
}

describe('sleepUnavailableReason', () => {
  const base = {
    capabilities: grblDriver.capabilities,
    activeControllerKind: 'grblhal' as const,
    grblSettingsRows: rows([]),
  };

  it('disables Release motors on grblHAL when $$ reported $62=0', () => {
    expect(sleepUnavailableReason({ ...base, grblSettingsRows: rows([[62, '0']]) })).toBe(
      GRBLHAL_SLEEP_DISABLED_MESSAGE,
    );
  });

  it('keeps it when $62=1, when $62 is not listed, or before any $$ read', () => {
    expect(sleepUnavailableReason({ ...base, grblSettingsRows: rows([[62, '1']]) })).toBeNull();
    expect(sleepUnavailableReason({ ...base, grblSettingsRows: rows([[30, '1000']]) })).toBeNull();
    expect(sleepUnavailableReason(base)).toBeNull();
  });

  it('ignores $62 on GRBL, where it means nothing', () => {
    expect(
      sleepUnavailableReason({
        ...base,
        activeControllerKind: 'grbl-v1.1',
        grblSettingsRows: rows([[62, '0']]),
      }),
    ).toBeNull();
  });

  it('names a controller with no sleep command', () => {
    expect(
      sleepUnavailableReason({
        ...base,
        capabilities: { ...grblDriver.capabilities, sleep: false },
      }),
    ).toBe(NO_SLEEP_COMMAND_MESSAGE);
  });

  it('explains a grblHAL error:3 refusal as the disabled setting', () => {
    expect(sleepRefusalMessage('grblhal', 'error:3')).toBe(GRBLHAL_SLEEP_DISABLED_MESSAGE);
    expect(sleepRefusalMessage('grbl-v1.1', 'error:8')).toContain('refused $SLP (error:8)');
  });
});

describe('Release motors against a controller that refuses $SLP', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await useLaserStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  async function connected(refuseSleep: boolean) {
    const writes: string[] = [];
    const connection = makeConnection(
      async (data) => {
        writes.push(data);
        if (data === '$SLP\n' && refuseSleep) queueMicrotask(() => connection.emitLine('error:3'));
      },
      { autoRespondToStatusQuery: true },
    );
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:10.000,20.000,0.000|WCO:5.000,10.000,0.000|FS:0,0>');
    await flushConnect();
    useLaserStore.setState({
      activeControllerKind: 'grblhal',
      workOriginActive: true,
      workOriginSource: 'g92',
    });
    writes.length = 0;
    return { writes, connection };
  }

  it('sends nothing when $$ reported $62=0', async () => {
    const { writes } = await connected(false);
    useLaserStore.setState({ grblSettingsRows: rows([[62, '0']]) });

    await expect(useLaserStore.getState().releaseMotors()).rejects.toThrow(
      GRBLHAL_SLEEP_DISABLED_MESSAGE,
    );
    expect(writes).not.toContain('$SLP\n');
  });

  it('keeps the origin and position evidence when the controller refuses $SLP', async () => {
    const { writes } = await connected(true);

    await expect(useLaserStore.getState().releaseMotors()).rejects.toThrow(
      GRBLHAL_SLEEP_DISABLED_MESSAGE,
    );
    expect(writes).toContain('$SLP\n');
    const laser = useLaserStore.getState();
    expect(laser.workOriginSource).toBe('g92');
    expect(laser.workOriginActive).toBe(true);
    expect(laser.positionEvidenceSuppressed).not.toBe(true);
    expect(laser.controllerOperation).toBeNull();
  });
});
