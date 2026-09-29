// "Use <last machine>" (ADR-500) and a machine-profile import replace the
// device profile. The saved machine's router values (Machine Setup stores them
// on the profile's cncSubProfile) must reach the CNC machine that compiles the
// job and the cached one the next Laser/CNC switch restores. Before the fix a
// session that had opened CNC kept the generic 3.81 mm safe Z and 12,000 RPM.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { createProject, type CncMachineParams } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const SAVED_4040: DeviceProfile = {
  ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  cncSubProfile: {
    safeZMm: 10,
    spindleMaxRpm: 10000,
    spindleSpinupSec: 3,
    coolant: 'off',
    parkZMm: 30,
    maxFeedMmPerMin: 2500,
    framingFeedMmPerMin: 1500,
  },
};

function cncParams(): CncMachineParams | null {
  const machine = useStore.getState().project.machine;
  return machine?.kind === 'cnc' ? machine.params : null;
}

describe('replaceDeviceProfile carries the saved router values', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
  });

  it('applies them to the active CNC machine', () => {
    useStore.getState().setMachineKind('cnc');
    expect(cncParams()?.safeZMm).toBe(3.81);

    useStore.getState().replaceDeviceProfile(SAVED_4040);

    expect(cncParams()).toEqual(SAVED_4040.cncSubProfile);
    useStore.getState().setMachineKind('laser');
    useStore.getState().setMachineKind('cnc');
    expect(cncParams()).toEqual(SAVED_4040.cncSubProfile);
  });

  it('applies them to the CNC machine a later switch restores', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().setMachineKind('laser');

    useStore.getState().replaceDeviceProfile(SAVED_4040);

    expect(useStore.getState().cachedCncMachine?.params).toEqual(SAVED_4040.cncSubProfile);
    expect(useStore.getState().project.parkedCncMachine?.params).toEqual(SAVED_4040.cncSubProfile);
    useStore.getState().setMachineKind('cnc');
    expect(cncParams()).toEqual(SAVED_4040.cncSubProfile);
  });

  it('undoes the profile and the router values together', () => {
    useStore.getState().setMachineKind('cnc');
    const before = cncParams();

    useStore.getState().replaceDeviceProfile(SAVED_4040);
    useStore.getState().undo();

    expect(useStore.getState().project.device.profileId).toBe(DEFAULT_DEVICE_PROFILE.profileId);
    expect(cncParams()).toEqual(before);
  });

  it('keeps the router values when the profile carries none', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().applyCncMachineSetup({ paramsPatch: { safeZMm: 7 } });
    const before = cncParams();
    expect(FALCON_A1_PRO_GRBLHAL_PROFILE.cncSubProfile).toBeUndefined();

    useStore.getState().replaceDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);

    expect(cncParams()).toEqual(before);
  });
});
