import { describe, expect, it } from 'vitest';
import { consoleSettingWriteIssue } from '../controllers/console-setting-writes';
import { selectControllerDriver } from '../controllers/select-controller-driver';
import { airStandbyRemedy } from './air-standby-remedy';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';

const { controllerKind: _kind, ...FALCON_WITHOUT_KIND } = FALCON_A1_PRO_GRBLHAL_PROFILE;
const { controllerCommandSet: _dropped, ...LEGACY_FALCON } = FALCON_A1_PRO_GRBLHAL_PROFILE;

type RemedyDevice = Pick<
  DeviceProfile,
  'controllerKind' | 'controllerCommandSet' | 'machineFamily'
>;

/** Whether the Console of the driver this device connects with sends `$152=100`. */
function consoleSends152(device: RemedyDevice): boolean {
  const driver = selectControllerDriver(device.controllerKind, device.controllerCommandSet);
  const prepared = driver.prepareConsoleCommand('$152=100');
  if (!prepared.ok) throw new Error(prepared.reason);
  return consoleSettingWriteIssue(driver, prepared.command) === null;
}

// Rolling audit v5 J8-P3-2 (ADR-370 Amendment 1): $152 is the Falcon A1's
// standby wait in stock-GRBL numbering and the Z microstep setting on grblHAL.
describe('airStandbyRemedy', () => {
  it("names the A1's standby setting for a Falcon on stock GRBL", () => {
    for (const device of [
      { ...FALCON_A1_PRO_GRBLHAL_PROFILE, controllerKind: 'grbl-v1.1' as const },
      FALCON_WITHOUT_KIND,
      FALCON_COMPATIBLE_PROFILE,
    ]) {
      expect(airStandbyRemedy(device)).toBe('standby-setting');
      // The advice can be followed: the Console sends it.
      expect(consoleSends152(device)).toBe(true);
    }
  });

  it('gives the Falcon A1 Pro preset, on grblHAL, the firmware remedy only', () => {
    expect(airStandbyRemedy(FALCON_A1_PRO_GRBLHAL_PROFILE)).toBe('grblhal-falcon');
    expect(consoleSends152(FALCON_A1_PRO_GRBLHAL_PROFILE)).toBe(false);
    // A copy saved before the preset had its command set is still a Falcon.
    expect(airStandbyRemedy(LEGACY_FALCON)).toBe('grblhal-falcon');
  });

  it('names no setting for any other machine', () => {
    expect(airStandbyRemedy(DEFAULT_DEVICE_PROFILE)).toBe('firmware');
    expect(airStandbyRemedy({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' })).toBe(
      'firmware',
    );
    expect(airStandbyRemedy({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, controllerKind: 'fluidnc' })).toBe(
      'firmware',
    );
  });
});
