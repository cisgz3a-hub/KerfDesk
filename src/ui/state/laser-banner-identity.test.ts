// Audit HF-8: grblHAL built at COMPATIBILITY_LEVEL >= 1 ("reporting itself as
// Grbl") prints the stock banner "Grbl 1.1f ['$' for help]" (grblHAL core
// report.c:310-314; GRBL_VERSION is "1.1f" at every level, grbl.h:38-43). On a
// grblHAL profile that banner is no evidence of stock GRBL, so the welcome
// handler must not log a mismatch the operator cannot clear by reconnecting,
// and Machine Setup must not offer "Use detected GRBL 1.1" (which on the Falcon
// profile would drop its 1024-byte window and its vendor bed convention).
// Every other GRBL version still contradicts grblHAL: grblHAL never prints it.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L310-L314

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { fluidncDriver, grblDriver, grblHalDriver } from '../../core/controllers';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { controllerIdentityWarnings } from '../laser/controller-identity-warnings';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const COMPAT_BANNER = "Grbl 1.1f ['$' for help]";
const STOCK_11H_BANNER = "Grbl 1.1h ['$' for help]";

function welcome(driver: typeof grblDriver, banner: string) {
  const harness = makeLineHandlerHarness();
  const refs = { ...harness.refs, driver };
  handleLine(harness.set, harness.get, refs, async () => undefined, banner);
  const state = harness.get();
  return {
    detected: state.detectedControllerKind,
    mismatchLogged: state.log.some((line) => line.includes('banner looks like')),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe('welcome banner identity (audit HF-8)', () => {
  it('reads "Grbl 1.1f" on the grblHAL driver as grblHAL, with no mismatch notice', () => {
    expect(welcome(grblHalDriver, COMPAT_BANNER)).toEqual({
      detected: 'grblhal',
      mismatchLogged: false,
    });
  });

  it('still flags "Grbl 1.1h" on the grblHAL driver', () => {
    expect(welcome(grblHalDriver, STOCK_11H_BANNER)).toEqual({
      detected: 'grbl-v1.1',
      mismatchLogged: true,
    });
  });

  it('keeps "Grbl 1.1f" stock GRBL on the GRBL driver and a mismatch on FluidNC', () => {
    expect(welcome(grblDriver, COMPAT_BANNER)).toEqual({
      detected: 'grbl-v1.1',
      mismatchLogged: false,
    });
    expect(welcome(fluidncDriver, COMPAT_BANNER)).toEqual({
      detected: 'grbl-v1.1',
      mismatchLogged: true,
    });
  });

  it('does not tell a Falcon owner to change the controller setting on "Grbl 1.1f"', async () => {
    vi.useFakeTimers();
    resetStore();
    useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const port = createFakeSerialPort();
    port.onOpen(() => setTimeout(() => port.emitLine(COMPAT_BANNER), 1));
    port.onWrite((data) => {
      if (data === '?') setTimeout(() => port.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'), 1);
      else if (data.endsWith('\n')) setTimeout(() => port.emitLine('ok'), 1);
    });
    await useLaserStore
      .getState()
      .connect(port.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
    await vi.advanceTimersByTimeAsync(1500);

    const laser = useLaserStore.getState();
    expect(laser.detectedControllerKind).toBe('grblhal');
    expect(laser.log.join('\n')).not.toMatch(/banner looks like/);
    expect(
      controllerIdentityWarnings(
        'grblhal',
        laser.activeControllerKind,
        laser.detectedControllerKind,
      ),
    ).toEqual([]);
  });
});
