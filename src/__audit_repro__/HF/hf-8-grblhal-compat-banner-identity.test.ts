// Audit HF-8 repro: a grblHAL build set to COMPATIBILITY_LEVEL >= 1 announces
// itself with the stock "Grbl 1.1f ['$' for help]" banner, and KerfDesk reads
// that as proof the controller is stock GRBL 1.1.
//
// Upstream grblHAL core (d7aaee3d84b1e7010f075d395206afff038d7379):
// - report.c:311-315 report_init_message():
//     #if COMPATIBILITY_LEVEL == 0
//         write(ASCII_EOL "GrblHAL " GRBL_VERSION " ['$' or '$HELP' for help]" ASCII_EOL);
//     #else
//         write(ASCII_EOL "Grbl " GRBL_VERSION " ['$' for help]" ASCII_EOL);
//     #endif
//   https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L311-L315
// - config.h:82-98 documents level 1 as "disable some extensions, and for
//   reporting itself as \"Grbl\"".
// - grbl.h:38-43: GRBL_VERSION is "1.1f" at every level, so grblHAL never
//   prints "Grbl 1.1h" (stock gnea/grbl 1.1h does).
//
// The Falcon A1 Pro profile selects grblHAL as a compatibility choice; the
// vendor's LightBurn device labels the machine GRBL-LPC and its firmware build
// and banner are unknown (docs/audits/2026-09-19-machine-compatibility-fixes).
//
// Correct behaviour: a "Grbl 1.1f" banner is consistent with a grblHAL profile,
// so KerfDesk must not state that the banner identifies GRBL 1.1 (Job Review
// warning, connect-time system notice, Machine Setup "Use detected GRBL 1.1"),
// and must not withdraw the Falcon vendor bed convention on that banner alone.
// A "Grbl 1.1h" banner still contradicts grblHAL (control case).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { detectControllerFromBanner } from '../../core/controllers';
import { DEFAULT_GRBL_RX_BUFFER_BYTES } from '../../core/grbl-streaming';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  CONTROLLER_IDENTITY_WARNING_PREFIX,
  controllerIdentityWarnings,
} from '../../ui/laser/controller-identity-warnings';
import { controllerProfileForSelection } from '../../ui/laser/device-setup/device-setup-controller-selection';
import { connectOptionsForDevice } from '../../ui/commands/connect-options';
import { useLaserStore } from '../../ui/state/laser-store';
import { resolveNativeBedFrame } from '../../ui/state/native-bed-frame';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

const GRBLHAL_COMPAT_BANNER = "Grbl 1.1f ['$' for help]";
const STOCK_GRBL_11H_BANNER = "Grbl 1.1h ['$' for help]";

function mismatchWarnings(banner: string): ReadonlyArray<string> {
  return controllerIdentityWarnings(
    'grblhal',
    'grblhal',
    detectControllerFromBanner(banner),
  ).filter((warning) => warning.startsWith(CONTROLLER_IDENTITY_WARNING_PREFIX));
}

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe('HF-8 grblHAL compatibility-level banner', () => {
  it('control: a stock "Grbl 1.1h" banner still contradicts a grblHAL profile', () => {
    expect(mismatchWarnings(STOCK_GRBL_11H_BANNER)).toHaveLength(1);
  });

  it('does not claim a "Grbl 1.1f" banner identifies stock GRBL on a grblHAL profile', () => {
    // Current code: "Controller identity mismatch: the selected profile and
    // active connection use grblHAL, but the firmware banner identifies GRBL
    // 1.1. Reconnect using the selected profile ..." (reconnecting cannot help).
    expect(mismatchWarnings(GRBLHAL_COMPAT_BANNER)).toEqual([]);
  });

  it('keeps the Falcon vendor bed convention when the banner reads "Grbl 1.1f"', () => {
    const device = {
      ...FALCON_A1_PRO_GRBLHAL_PROFILE,
      homing: { ...FALCON_A1_PRO_GRBLHAL_PROFILE.homing, enabled: true },
    };
    const evidence = {
      homingState: 'confirmed',
      activeControllerKind: 'grblhal' as const,
      activeControllerCommandSet: 'creality-falcon-a1-pro' as const,
    };
    // Same evidence with no banner resolves the vendor frame (existing behaviour).
    expect(resolveNativeBedFrame(device, evidence)?.nativeToBedOffsetMm).toEqual({ x: 0, y: 0 });
    // Current code: null (the canvas falls back to artwork-relative with the
    // "controller-to-bed coordinate mapping is unverified" advisory).
    const detectedControllerKind = detectControllerFromBanner(GRBLHAL_COMPAT_BANNER);
    expect(
      resolveNativeBedFrame(device, { ...evidence, detectedControllerKind })?.nativeToBedOffsetMm,
    ).toEqual({ x: 0, y: 0 });
  });

  it('consequence (passes today): following "Use detected GRBL 1.1" drops the Falcon window to 120 bytes', () => {
    const draft = controllerProfileForSelection(FALCON_A1_PRO_GRBLHAL_PROFILE, 'grbl-v1.1');
    expect(draft.controllerCommandSet).toBe('creality-falcon-a1-pro');
    expect(draft.rxBufferBytes).toBe(DEFAULT_GRBL_RX_BUFFER_BYTES);
  });

  it('does not tell a Falcon owner to change the controller setting on a "Grbl 1.1f" banner', async () => {
    vi.useFakeTimers();
    resetStore();
    useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    const port = createFakeSerialPort();
    port.onOpen(() => setTimeout(() => port.emitLine(GRBLHAL_COMPAT_BANNER), 1));
    port.onWrite((data) => {
      if (data === '?') setTimeout(() => port.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'), 1);
      else if (data.endsWith('\n')) setTimeout(() => port.emitLine('ok'), 1);
    });
    await useLaserStore
      .getState()
      .connect(port.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
    await vi.advanceTimersByTimeAsync(1500);
    expect(useLaserStore.getState().detectedControllerKind).toBe('grbl-v1.1');
    // Current code logs: "[lf2] Controller banner looks like grbl-v1.1, but the
    // profile selected grblhal. Check the device profile's controller setting."
    expect(useLaserStore.getState().log.join('\n')).not.toMatch(/banner looks like grbl-v1\.1/);
  });
});
