// The work area a `$$` gives a homed machine (rolling audit v8 N2-P2-1,
// ADR-637 Amendment 4). grblHAL's homed envelope, machine_limits.c
// limits_set_work_envelope at f8f10aec: with hard limits on, the pull-off
// comes off the far edge, and off the homing edge too without force origin.
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139

import { describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_DUMP } from '../../../__fixtures__/controllers/falcon-a1-pro-dump';
import {
  GRBLHAL_LASER_DUMP,
  GRBLHAL_LEVEL_2_DUMP,
  grblHalSettingsMap,
} from '../../../__fixtures__/controllers/grblhal-settings-dump';
import { settingsMapToControllerSettings } from './parse-settings';
import { reportedWorkArea, travelEnvelopeFirmware } from './reported-work-area';

function settingsOf(dump: ReadonlyArray<string>, overrides: Record<number, string> = {}) {
  return settingsMapToControllerSettings(grblHalSettingsMap(overrides, dump));
}

describe('reportedWorkArea', () => {
  it('is the published Falcon A1 Pro envelope, 358 x 268, from its 363 x 273 travel', () => {
    expect(reportedWorkArea(settingsOf(FALCON_A1_PRO_DUMP), 'grblhal')).toEqual({
      widthMm: 358,
      heightMm: 268,
    });
  });

  it('takes the pull-off off both edges without force origin', () => {
    // $21=1 $22=1 (with $384 listed, so force origin is read as off) $27=2.
    expect(reportedWorkArea(settingsOf(GRBLHAL_LASER_DUMP), 'grblhal')).toEqual({
      widthMm: 396,
      heightMm: 296,
    });
  });

  it('keeps the travel when grblHAL keeps it or the dump leaves the inset unknown', () => {
    const travel = { widthMm: 400, heightMm: 300 };
    expect(reportedWorkArea(settingsOf(GRBLHAL_LASER_DUMP, { 21: '0' }), 'grblhal')).toEqual(
      travel,
    );
    expect(reportedWorkArea(settingsOf(GRBLHAL_LASER_DUMP, { 22: '0' }), 'grblhal')).toEqual(
      travel,
    );
    // A level 2 build prints `$22` as 0 or 1 and no `$384`: force origin unread.
    expect(reportedWorkArea(settingsOf(GRBLHAL_LEVEL_2_DUMP), 'grblhal')).toEqual(travel);
    const noPullOff = new Map(grblHalSettingsMap());
    noPullOff.delete(27);
    expect(reportedWorkArea(settingsMapToControllerSettings(noPullOff), 'grblhal')).toEqual(travel);
  });

  it('keeps stock GRBL at its full travel', () => {
    // The switch sits on the envelope's edge and the far edge is not inset.
    expect(reportedWorkArea(settingsOf(FALCON_A1_PRO_DUMP), 'grbl')).toEqual({
      widthMm: 363,
      heightMm: 273,
    });
    expect(reportedWorkArea(settingsOf(GRBLHAL_LASER_DUMP), null)).toEqual({
      widthMm: 400,
      heightMm: 300,
    });
  });

  it('is unknown without both travels', () => {
    expect(reportedWorkArea({ bedWidth: 400 }, 'grblhal')).toBeNull();
  });

  it('rounds to the dump’s 0.001 mm', () => {
    const area = reportedWorkArea(
      settingsOf(FALCON_A1_PRO_DUMP, { 27: '1.100', 130: '300.300' }),
      'grblhal',
    );
    expect(area?.widthMm).toBe(299.2);
  });
});

describe('travelEnvelopeFirmware', () => {
  it.each([
    ['grblhal', 'grblhal', 'grblhal'],
    ['grblhal', 'grbl-v1.1', 'grblhal'],
    ['grbl-v1.1', 'grblhal', 'grblhal'],
    ['grbl-v1.1', null, 'grbl'],
    ['grbl-v1.1', 'fluidnc', null],
    ['marlin', null, null],
  ] as const)('a %s profile with a %s banner has %s travel', (active, detected, expected) => {
    expect(travelEnvelopeFirmware(active, detected)).toBe(expected);
  });
});
