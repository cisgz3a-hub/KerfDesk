// ADR-491 Amendment 2 (meta audit M7-P1-2, second CNC audit P2-control-1): a
// park height that fits the Z travel can still lift past the top of Z when Z
// was zeroed low. GRBL with `$23=0` homes Z to the top, where machine Z is 0
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L366-L384),
// and the program's work Z lands at machine Z = work Z + WCO Z.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { CncGroup, Job } from '../../core/job';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import {
  checkCncLiftAgainstZTop,
  detectCncParkZTopWarnings,
  type CncZTopEvidence,
} from './cnc-park-z-top';

const DEVICE = { ...DEFAULT_DEVICE_PROFILE, zTravelMm: 75 };

/** A homed stock GRBL router: $132=75, $23=0 (Z homes up), $20=0 and $21=0. */
function homedRouter(patch: Partial<CncZTopEvidence> = {}): CncZTopEvidence {
  const base = stockNativeEvidence(DEVICE, false, 0);
  return {
    ...base,
    controllerSettings: {
      ...base.controllerSettings,
      zTravelMm: 75,
      softLimitsEnabled: false,
      hardLimitsEnabled: false,
    },
    // Stock top zeroed 40 mm below the homed top.
    wcoCache: { x: -200, y: -150, z: -40 },
    activeWcs: 'G54',
    ...patch,
  };
}

const cncProject: Project = { ...createProject(DEVICE), machine: DEFAULT_CNC_MACHINE_CONFIG };

function job(parkZMm: number | undefined): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'L1',
    color: '#000000',
    cutType: 'profile-outside',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 5,
    ...(parkZMm === undefined ? {} : { parkZMm }),
    passes: [{ kind: 'contour', zMm: -3, closed: false, polyline: [{ x: 0, y: 0 }, { x: 9, y: 0 }] }],
  };
  return { groups: [group] };
}

describe('CNC park lift against the live Z top', () => {
  it('finds a 50 mm park 10 mm past the top when Z is zeroed 40 mm below it', () => {
    expect(checkCncLiftAgainstZTop(50, homedRouter())).toEqual({
      kind: 'over',
      overMm: 10,
      highestFitMm: 40,
    });
    const [warning] = detectCncParkZTopWarnings(cncProject, job(50), homedRouter());
    expect(warning).toContain('lifts to Z50 above the stock top, 10 mm past the top of Z travel');
    expect(warning).toContain('Set Park height to 40 mm or lower');
  });

  it('says how much room a park that fits leaves', () => {
    expect(checkCncLiftAgainstZTop(30, homedRouter())).toEqual({ kind: 'fits', roomMm: 10 });
    expect(detectCncParkZTopWarnings(cncProject, job(30), homedRouter())).toEqual([]);
  });

  it('reads an inch offset in millimetres', () => {
    const inches = homedRouter({
      wcoCache: { x: 0, y: 0, z: -1 },
      controllerSettings: { ...homedRouter().controllerSettings, reportInches: true },
    });
    expect(checkCncLiftAgainstZTop(30, inches)).toMatchObject({ kind: 'over', highestFitMm: 25.4 });
  });

  it('keeps the switch pull-off clear when hard limits are on', () => {
    const hard = homedRouter({
      controllerSettings: {
        ...homedRouter().controllerSettings,
        hardLimitsEnabled: true,
        homingPullOffMm: 2,
      },
    });
    expect(checkCncLiftAgainstZTop(39, hard)).toMatchObject({ kind: 'over', highestFitMm: 38 });
  });

  it.each<[string, Partial<CncZTopEvidence>, string]>([
    ['no Home and soft limits off', { homingState: 'unknown' }, "this session's $$ and Home"],
    ['no work offset reported', { wcoCache: null }, 'not reported its work offset'],
    ['report units not confirmed', { reportUnitsUnconfirmed: true }, 'not reported its work'],
    ['another work system active', { activeWcs: 'G55' }, "G55's, not G54's"],
  ])('says the check could not run with %s', (_, patch, reason) => {
    const check = checkCncLiftAgainstZTop(50, homedRouter(patch));
    expect(check.kind).toBe('unchecked');
    if (check.kind === 'unchecked') expect(check.reason).toContain(reason);
    expect(detectCncParkZTopWarnings(cncProject, job(50), homedRouter(patch))).toEqual([]);
  });

  it('checks an unhomed stock GRBL whose soft limits are on, against its own envelope', () => {
    const soft = homedRouter({
      homingState: 'unknown',
      controllerSettings: { ...homedRouter().controllerSettings, softLimitsEnabled: true },
    });
    expect(checkCncLiftAgainstZTop(50, soft).kind).toBe('over');
  });

  it("uses the profile's recorded Z travel when $132 was not read", () => {
    const read = homedRouter().controllerSettings;
    if (read == null) throw new Error('expected settings');
    const { zTravelMm: _read, ...settings } = read;
    const unread = homedRouter({ controllerSettings: settings });
    expect(checkCncLiftAgainstZTop(50, unread).kind).toBe('unchecked');
    expect(checkCncLiftAgainstZTop(50, unread, 75)).toMatchObject({ kind: 'over', overMm: 10 });
    expect(detectCncParkZTopWarnings(cncProject, job(50), unread)).toHaveLength(1);
  });

  it('lifts no higher than safe Z without a park height', () => {
    expect(detectCncParkZTopWarnings(cncProject, job(undefined), homedRouter())).toEqual([]);
  });
});
