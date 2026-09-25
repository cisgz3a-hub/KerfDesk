// Audit HF-4 repro: on the Falcon A1 Pro profile a refused Release motors
// (`$SLP` -> error:3) tells the operator to "Set $62=1 in the controller
// settings", but the Falcon contract refuses every numeric `$N=` write except
// $150-$152 in the Console and has no Machine Settings panel, and `$62=0` was
// never read (the contract sends no `$$`).
//
// Upstream: grblHAL core system.c:572-576 answers `$SLP` with
// Status_InvalidStatement (error:3) when `!settings.flags.sleep_enable`, and
// settings.c:2141-2143 makes `$62` exist only when SLEEP_DURATION > 0, so on a
// vendor build error:3 does not even prove a `$62` setting exists.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L572-L576
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2141-L2143
//
// Correct behaviour: the refusal names only a remedy the active profile can
// carry out; when the driver cannot write `$62`, it must not tell the operator
// to set `$62=1` from KerfDesk. Current code: controller-sleep.ts
// sleepRefusalMessage() keys only on activeControllerKind === 'grblhal'.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../../ui/commands/connect-options';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

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

describe('HF-4 Falcon Release motors refusal', () => {
  it('does not advise a $62=1 write that the Falcon profile refuses', async () => {
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

    // The remedy the message names, tried the only way the Falcon profile allows.
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

    // Correct: the refusal does not tell the operator to set $62=1 here.
    // Current code: "Sleep ($SLP) is disabled in this grblHAL build ($62=0).
    // Set $62=1 in the controller settings to release the motors from KerfDesk."
    expect(refusal).not.toMatch(/\$62=1/);
  });
});
