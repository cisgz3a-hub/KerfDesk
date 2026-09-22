import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  settingsMapToControllerSettings,
  settingsMapToProfilePatch,
} from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../../../core/devices';
import { deviceProfileWithInteractivePatch } from '../../../core/devices/device-profile-patch';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import {
  deserializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeMachineProfileDocument,
} from '../../../io/machine-profile';
import { deserializeProject, serializeProject } from '../../../io/project';
import { applyDetectedSettingsPatch } from '../../state/detected-settings-action';
import { useStore } from '../../state/store';
import { resetStore } from '../../state/test-helpers';
import { focusJogReady } from '../FocusJogControls';
import { deviceSetupReducer, initDeviceSetup, machineSetupProfile } from './device-setup-flow';

const ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];

beforeEach(resetStore);
afterEach(resetStore);

function confirmedZProfile(): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'z-axis'],
    zTravelMm: 75,
    zTravelConfirmed: true,
  };
}

describe('Independent coordinate settings audit 2026-09-21', () => {
  it.each(ORIGINS)(
    'preserves distinct geometry and optional coordinate fields for %s',
    (origin) => {
      const patch: Partial<DeviceProfile> = {
        bedWidth: 358.125,
        bedHeight: 268.25,
        origin,
        homing: { enabled: true, direction: 'rear-right' },
        framingFeedMmPerMin: 9876,
        maxFeed: 4321,
        zTravelMm: 63.5,
        zTravelConfirmed: false,
        noGoZones: [{ id: 'clamp', name: 'Clamp', enabled: true, x: 4, y: 7, width: 8, height: 9 }],
        rotary: {
          enabled: true,
          type: 'chuck',
          mmPerRotation: 251.25,
          objectDiameterMm: 72.5,
          reverseAxis: true,
        },
      };
      const state = deviceSetupReducer(initDeviceSetup(FALCON_A1_PRO_GRBLHAL_PROFILE, null), {
        kind: 'edit',
        patch,
      });
      const profile = machineSetupProfile(state);
      useStore.getState().replaceMachineSetup(profile, LASER_MACHINE_CONFIG);
      const project = useStore.getState().project;
      expect(project.workspace).toMatchObject({ width: 358.125, height: 268.25, units: 'mm' });
      const loadedProject = deserializeProject(serializeProject(project));
      expect(loadedProject.kind).toBe('ok');
      if (loadedProject.kind !== 'ok') throw new Error('Project round trip failed');
      expect(loadedProject.project.device).toMatchObject(patch);

      const loadedProfile = deserializeMachineProfileDocument(
        serializeMachineProfileDocument({
          format: MACHINE_PROFILE_FORMAT,
          schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
          profile,
          source: { kind: 'custom', label: 'Independent coordinate audit' },
          reviewNotes: [],
        }),
      );
      expect(loadedProfile.kind).toBe('ok');
      if (loadedProfile.kind !== 'ok') throw new Error('Machine profile round trip failed');
      expect(loadedProfile.document.profile).toMatchObject(patch);
      expect(loadedProfile.document.profile.controllerCommandSet).toBe('creality-falcon-a1-pro');
    },
  );

  it('keeps homing, direction, pull-off and report units as observations, not profile guesses', () => {
    const raw = new Map([
      [13, '1'],
      [22, '1'],
      [23, '3'],
      [27, '2.5'],
      [110, '10000'],
      [111, '7200'],
      [130, '358'],
      [131, '268'],
    ]);
    const patch = settingsMapToProfilePatch(raw);
    expect(patch).toEqual({ maxFeed: 10000, bedWidth: 358, bedHeight: 268 });
    expect(settingsMapToControllerSettings(raw)).toMatchObject({
      reportInches: true,
      homingEnabled: true,
      homingDirectionMask: 3,
      homingPullOffMm: 2.5,
      maxFeedX: 10000,
      maxFeedY: 7200,
    });
  });

  it('preserves an unchanged measured Z travel confirmation', () => {
    useStore.getState().replaceDeviceProfile(confirmedZProfile());
    applyDetectedSettingsPatch(settingsMapToProfilePatch(new Map([[132, '75']])));
    expect(useStore.getState().project.device.zTravelConfirmed).toBe(true);
  });

  // These audit regressions failed before the shared interactive-patch fix:
  // changed detected travel inherited a confirmation for a different value.
  it('requires new Z confirmation after direct detected travel replacement', () => {
    useStore.getState().replaceDeviceProfile(confirmedZProfile());
    applyDetectedSettingsPatch(settingsMapToProfilePatch(new Map([[132, '150']])));
    const device = useStore.getState().project.device;
    expect(device.zTravelMm).toBe(150);
    expect(focusJogReady(device, 'laser')).toBe(false);
    expect(device.zTravelConfirmed).not.toBe(true);
  });

  it('requires new Z confirmation when the setup wizard accepts changed detected travel', () => {
    const state = deviceSetupReducer(initDeviceSetup(confirmedZProfile(), null), {
      kind: 'accept-detected',
      patch: settingsMapToProfilePatch(new Map([[132, '150']])),
    });
    expect(state.draft.zTravelMm).toBe(150);
    expect(focusJogReady(state.draft, 'laser')).toBe(false);
    expect(state.draft.zTravelConfirmed).not.toBe(true);
  });

  it('allows explicit fresh confirmation of newly measured travel', () => {
    const device = deviceProfileWithInteractivePatch(confirmedZProfile(), {
      zTravelMm: 100,
      zTravelConfirmed: true,
    });
    expect(focusJogReady(device, 'laser')).toBe(true);
    expect(device.zTravelMm).toBe(100);
  });
});
