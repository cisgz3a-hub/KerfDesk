import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { ORTUR_LASER_MASTER_3_PROFILES } from '../../core/devices/brand-laser-profiles';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  liveDriverMismatch,
  reviewDriverSwitchText,
  reviewStatusText,
  toolbarDriverMismatchText,
  toolbarMachineName,
  type LiveDriverSession,
} from './live-driver-mismatch';

const STOCK_GRBL: LiveDriverSession = {
  connected: true,
  activeControllerKind: 'grbl-v1.1',
  activeControllerCommandSet: null,
};
const GENERIC_GRBLHAL: LiveDriverSession = {
  connected: true,
  activeControllerKind: 'grblhal',
  activeControllerCommandSet: null,
};
const MARLIN_LASER_PROFILE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin' };

describe('liveDriverMismatch (U2-P2-1)', () => {
  it('names the stale driver for every preset whose driver differs from the starter', () => {
    expect(ORTUR_LASER_MASTER_3_PROFILES).toHaveLength(3);
    for (const profile of [
      FALCON_A1_PRO_GRBLHAL_PROFILE,
      ...ORTUR_LASER_MASTER_3_PROFILES,
      MARLIN_LASER_PROFILE,
    ]) {
      expect(liveDriverMismatch(profile, STOCK_GRBL)?.live.label).toBe('GRBL v1.1');
    }
    // A CNC that is not listed, on FluidNC, against the GRBL starter's session.
    expect(
      liveDriverMismatch({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'fluidnc' }, STOCK_GRBL)
        ?.profile.label,
    ).toBe('FluidNC');
  });

  it('counts a missing vendor command set as a mismatch inside the same family', () => {
    const mismatch = liveDriverMismatch(FALCON_A1_PRO_GRBLHAL_PROFILE, GENERIC_GRBLHAL);
    expect(mismatch?.live.commandSet).toBeUndefined();
    expect(mismatch?.profile.commandSet).toBe('creality-falcon-a1-pro');
  });

  it('is null when the drivers match or nothing is connected', () => {
    expect(liveDriverMismatch(DEFAULT_DEVICE_PROFILE, STOCK_GRBL)).toBeNull();
    expect(
      liveDriverMismatch(FALCON_A1_PRO_GRBLHAL_PROFILE, {
        ...GENERIC_GRBLHAL,
        activeControllerCommandSet: 'creality-falcon-a1-pro',
      }),
    ).toBeNull();
    expect(
      liveDriverMismatch(FALCON_A1_PRO_GRBLHAL_PROFILE, { ...STOCK_GRBL, connected: false }),
    ).toBeNull();
  });
});

describe('Review wording', () => {
  it('does not call the setup internally consistent while Save must switch the driver', () => {
    const mismatch = liveDriverMismatch(FALCON_A1_PRO_GRBLHAL_PROFILE, STOCK_GRBL)!;
    const text = reviewStatusText([], reviewDriverSwitchText(mismatch));
    expect(text).not.toContain('internally consistent');
    expect(text).toBe(
      'You are connected with the generic GRBL v1.1 commands, but this setup uses the Falcon A1 ' +
        'Pro (GRBL-compatible commands). Saving reconnects to use them, which does not run or ' +
        'home the machine. If the machine is busy, Save keeps the connection and the toolbar ' +
        'offers Reconnect now; until then Home, jog and Frame use the old commands.',
    );
  });

  it('keeps the ready line when the drivers match, and issues first', () => {
    expect(reviewStatusText([], null)).toContain('internally consistent');
    expect(reviewStatusText(['Work area is empty'], 'switch')).toBe(
      'Fix the issues below, then return here to save your setup.',
    );
  });
});

describe('toolbar wording', () => {
  it('does not name the vendor command set while another driver is live', () => {
    const mismatch = liveDriverMismatch(FALCON_A1_PRO_GRBLHAL_PROFILE, STOCK_GRBL);
    const name = toolbarMachineName(FALCON_A1_PRO_GRBLHAL_PROFILE.name, mismatch);
    expect(name).toBe('Creality Falcon A1 Pro (connected with GRBL v1.1 commands)');
    expect(name).not.toContain('vendor command set');
    expect(toolbarDriverMismatchText(mismatch!)).toBe(
      'Connected with the generic GRBL v1.1 commands. This machine uses the Falcon A1 Pro ' +
        '(GRBL-compatible commands): Home, jog and Frame use the old ones until you reconnect.',
    );
  });

  it('names a generic family plainly and leaves a matching session alone', () => {
    const mismatch = liveDriverMismatch(MARLIN_LASER_PROFILE, STOCK_GRBL);
    expect(toolbarMachineName('Shop Marlin', mismatch)).toBe(
      'Shop Marlin (connected with GRBL v1.1 commands)',
    );
    expect(toolbarDriverMismatchText(mismatch!)).toContain('uses the generic Marlin commands');
    expect(toolbarMachineName(FALCON_A1_PRO_GRBLHAL_PROFILE.name, null)).toBe(
      FALCON_A1_PRO_GRBLHAL_PROFILE.name,
    );
  });
});
