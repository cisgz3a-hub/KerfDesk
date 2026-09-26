// Controller audit drivers-4: grblHAL answers `$SLP` with error:3 unless its
// `$62` Sleep enable setting is on. Release motors is disabled when a `$$`
// read reported `$62=0`, and a refused `$SLP` leaves the origin and position
// evidence alone instead of voiding them behind a controller-error notice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { grblDriver } from '../../core/controllers';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import {
  GRBLHAL_SLEEP_DISABLED_MESSAGE,
  NO_SLEEP_COMMAND_MESSAGE,
  sleepRefusalMessage,
  sleepUnavailableReason,
} from './controller-sleep';
import { useLaserStore } from './laser-store';
import { connectWith, flushConnect, makeConnection } from './laser-store-console.test-support';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function rows(entries: ReadonlyArray<readonly [number, string]>) {
  return settingsMapToRows(new Map(entries));
}

const FALCON_CAPABILITIES = { ...grblDriver.capabilities, settings: 'none' as const };

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

  it('does not advise a $62=1 write on a driver that cannot write settings', () => {
    const reason = sleepUnavailableReason({
      ...base,
      capabilities: FALCON_CAPABILITIES,
      grblSettingsRows: rows([[62, '0']]),
    });
    expect(reason).toContain('($62=0)');
    expect(reason).not.toContain('$62=1');
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

  it('explains a grblHAL error:3 refusal as the disabled setting when $$ reported $62=0', () => {
    expect(sleepRefusalMessage({ ...base, grblSettingsRows: rows([[62, '0']]) }, 'error:3')).toBe(
      GRBLHAL_SLEEP_DISABLED_MESSAGE,
    );
    expect(
      sleepRefusalMessage({ ...base, activeControllerKind: 'grbl-v1.1' }, 'error:8'),
    ).toContain('refused $SLP (error:8)');
  });

  // Audit HF-4: error:3 alone proves neither that `$62` exists nor that it is
  // 0. grblHAL registers `$62` only when SLEEP_DURATION > 0 (settings.c:2141-2143)
  // and answers `$SLP` with error:3 whenever sleep is disabled (system.c:572-576).
  it('does not claim $62=0 when $$ never reported it', () => {
    const message = sleepRefusalMessage(base, 'error:3');
    expect(message).not.toContain('($62=0)');
    expect(message).toContain('sleep is disabled or not supported');
    expect(message).toContain('The motors are still energized');
    expect(message).toContain('set $62=1');
  });

  it('names no $62=1 remedy on a driver that cannot write numeric settings (the Falcon)', () => {
    const refused = sleepRefusalMessage({ ...base, capabilities: FALCON_CAPABILITIES }, 'error:3');
    expect(refused).not.toMatch(/\$62/);
    expect(refused).toContain('The controller refused $SLP (error:3)');
    expect(refused).toContain('The motors are still energized');

    const reportedOff = sleepRefusalMessage(
      { ...base, capabilities: FALCON_CAPABILITIES, grblSettingsRows: rows([[62, '0']]) },
      'error:3',
    );
    expect(reportedOff).toContain('($62=0)');
    expect(reportedOff).not.toContain('$62=1');
  });
});

describe('Falcon A1 Pro Release motors refused with error:3 (audit HF-4)', () => {
  const IDLE = '<Idle|MPos:10.000,10.000,0.000|FS:0,0>';

  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await useLaserStore.getState().disconnect();
    resetStore();
    vi.restoreAllMocks();
  });

  it('does not advise the $62=1 write that the Falcon Console refuses', async () => {
    const port = createFakeSerialPort();
    port.onOpen(() => setTimeout(() => port.emitLine("GrblHAL 1.1f ['$' or '$HELP' for help]"), 1));
    port.onWrite((data) => {
      if (data === '?') setTimeout(() => port.emitLine(IDLE), 1);
      else if (data === '$SLP\n') setTimeout(() => port.emitLine('error:3'), 1);
      else if (data.endsWith('\n')) {
        setTimeout(() => {
          if (data === '$G\n') port.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
          port.emitLine('ok');
        }, 1);
      }
    });
    await useLaserStore
      .getState()
      .connect(port.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
    await vi.advanceTimersByTimeAsync(1500);

    let refusal = 'pending';
    useLaserStore
      .getState()
      .releaseMotors()
      .then(
        () => (refusal = 'resolved'),
        (error: unknown) => (refusal = error instanceof Error ? error.message : String(error)),
      );
    await vi.advanceTimersByTimeAsync(2000);
    expect(port.outbound()).toContain('$SLP\n');

    // The only remedy the old message named, tried the only way the profile allows.
    let consoleResult = 'pending';
    useLaserStore
      .getState()
      .sendConsoleCommand('$62=1', { confirmed: true })
      .then(
        () => (consoleResult = 'sent'),
        (error: unknown) =>
          (consoleResult = error instanceof Error ? error.message : String(error)),
      );
    await vi.advanceTimersByTimeAsync(2000);
    expect(consoleResult).toMatch(/does not send numeric \$ setting writes/);

    expect(refusal).not.toMatch(/\$62/);
    expect(refusal).toContain('The controller refused $SLP (error:3)');
    expect(refusal).toContain('The motors are still energized');
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

    // No `$$` reported `$62`, so the refusal claims no `$62=0` (audit HF-4).
    await expect(useLaserStore.getState().releaseMotors()).rejects.toThrow(
      /refused \$SLP \(error:3\): sleep is disabled or not supported/,
    );
    expect(writes).toContain('$SLP\n');
    const laser = useLaserStore.getState();
    expect(laser.workOriginSource).toBe('g92');
    expect(laser.workOriginActive).toBe(true);
    expect(laser.positionEvidenceSuppressed).not.toBe(true);
    expect(laser.controllerOperation).toBeNull();
  });
});
