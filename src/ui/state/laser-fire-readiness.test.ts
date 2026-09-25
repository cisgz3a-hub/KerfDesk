// Fire's gate without Labs (ADR-387). One function decides both the button
// face and the Fire action's refusal, so every ADR-162 machine-state
// precondition is pinned here once, by name.

import { describe, expect, it } from 'vitest';
import { grblDriver, marlinDriver } from '../../core/controllers';
import { createStreamer } from '../../core/controllers/grbl';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import {
  FIRE_NOT_ENABLED_MESSAGE,
  fireActivationBlock,
  fireSetupForProject,
} from './laser-fire-readiness';
import { useLaserStore, type LaserState } from './laser-store';

const OPTED_IN = { enabled: true, maxPowerPercent: 1 } as const;

function laserProject(device: DeviceProfile): Project {
  return { ...createProject(device), machine: { kind: 'laser' } };
}

function readyState(): LaserState {
  return {
    ...useLaserStore.getState(),
    connection: { kind: 'connected' },
    capabilities: grblDriver.capabilities,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
      pins: null,
      ov: null,
    },
    mpgActive: null,
    alarmCode: null,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    probeBusy: false,
    pendingUntrackedAcks: 0,
    fireActive: false,
  };
}

const neotronicsOptedIn = laserProject({
  ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  fireControl: OPTED_IN,
});

describe('Fire setup for the active project', () => {
  it('enables an opted-in Neotronics 4040 with no Labs switch and no catalog capability', () => {
    expect(fireSetupForProject(neotronicsOptedIn)).toEqual({
      kind: 'enabled',
      control: OPTED_IN,
      percent: 1,
      powerS: 10,
    });
    expect(fireActivationBlock(readyState(), neotronicsOptedIn)).toBeNull();
  });

  it('keeps a Falcon profile that already had Fire enabled working', () => {
    const falcon = laserProject({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, fireControl: OPTED_IN });
    expect(fireSetupForProject(falcon)).toMatchObject({ kind: 'enabled', powerS: 10 });
    expect(fireActivationBlock(readyState(), falcon)).toBeNull();
  });

  it('asks for the machine opt-in before anything else', () => {
    const notOptedIn = laserProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    expect(fireSetupForProject(notOptedIn)).toEqual({
      kind: 'needs-setup',
      reason: FIRE_NOT_ENABLED_MESSAGE,
    });
    const disconnected = { ...readyState(), connection: { kind: 'disconnected' as const } };
    expect(fireActivationBlock(disconnected, notOptedIn)).toEqual({
      caption: 'Set up',
      message: FIRE_NOT_ENABLED_MESSAGE,
    });
  });

  it('explains a machine that cannot offer Fire instead of hiding it', () => {
    const marlin = laserProject({
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      fireControl: OPTED_IN,
    });
    expect(fireSetupForProject(marlin)).toEqual({
      kind: 'unavailable',
      reason: expect.stringContaining('Marlin controllers have no Fire button'),
    });
    expect(fireActivationBlock(readyState(), marlin)?.caption).toBe('Unavailable');
  });

  it('hides Fire on a CNC project', () => {
    const cncProject: Project = { ...neotronicsOptedIn, machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(fireSetupForProject(cncProject)).toEqual({ kind: 'hidden' });
    expect(fireActivationBlock(readyState(), cncProject)?.message).toBe(
      'Fire is unavailable for CNC projects.',
    );
  });

  it('sends the operator to Machine Setup when the Fire power rounds to S0', () => {
    const tinyScale = laserProject({
      ...DEFAULT_DEVICE_PROFILE,
      maxPowerS: 255,
      fireControl: { enabled: true, maxPowerPercent: 0.1 },
    });
    expect(fireSetupForProject(tinyScale)).toEqual({
      kind: 'needs-setup',
      reason: expect.stringContaining('rounds to S0'),
    });
  });
});

describe('ADR-162 machine-state preconditions', () => {
  const home = { kind: 'home', phase: 'command', idleReports: 0, operationId: 1 } as const;
  const jog = {
    operationId: 1,
    kind: 'jog',
    sawControllerBusy: false,
    idleStatusReports: 0,
    dispatchComplete: true,
    pendingLines: [],
  } as const;
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly patch: (state: LaserState) => Partial<LaserState>;
    readonly caption: string;
    readonly message: string;
  }> = [
    {
      name: 'not connected',
      patch: () => ({ connection: { kind: 'disconnected' } }),
      caption: 'Not connected',
      message: 'Connect to the laser first.',
    },
    {
      name: 'a connected controller without Fire',
      patch: () => ({ capabilities: marlinDriver.capabilities }),
      caption: 'Unsupported',
      message: 'does not support Fire',
    },
    {
      name: 'an MPG takeover',
      patch: () => ({ mpgActive: true }),
      caption: 'MPG active',
      message: 'MPG',
    },
    {
      name: 'an alarm',
      patch: () => ({ alarmCode: 9 }),
      caption: 'Alarm',
      message: 'Clear the controller alarm',
    },
    {
      name: 'no status report yet',
      patch: () => ({ statusReport: null }),
      caption: 'No status',
      message: 'Wait for an Idle position report',
    },
    {
      name: 'a machine that is not Idle',
      patch: (state) => ({ statusReport: withState(state, 'Run') }),
      caption: 'Not idle',
      message: 'Machine must be Idle before using Fire (currently Run).',
    },
    {
      name: 'a report with no position',
      patch: (state) => ({ statusReport: withoutPosition(state) }),
      caption: 'No position',
      message: 'trusted live position report',
    },
    {
      name: 'a running job',
      patch: () => ({ streamer: { ...createStreamer('G1 X1\n'), status: 'streaming' } }),
      caption: 'Job running',
      message: 'A job is active',
    },
    {
      name: 'a jog or Frame in motion',
      patch: () => ({ motionOperation: jog }),
      caption: 'Moving',
      message: 'jog or frame operation',
    },
    {
      name: 'a controller operation',
      patch: () => ({ controllerOperation: home }),
      caption: 'Busy',
      message: 'controller operation',
    },
    {
      name: 'auto-focus',
      patch: () => ({ autofocusBusy: true }),
      caption: 'Focusing',
      message: 'auto-focus',
    },
    {
      name: 'probing',
      patch: () => ({ probeBusy: true }),
      caption: 'Probing',
      message: 'probing',
    },
    {
      name: 'an unacknowledged command',
      patch: () => ({ pendingUntrackedAcks: 1 }),
      caption: 'Waiting',
      message: 'acknowledge the previous command',
    },
  ];

  for (const entry of cases) {
    it(`refuses Fire during ${entry.name}`, () => {
      const base = readyState();
      const block = fireActivationBlock({ ...base, ...entry.patch(base) }, neotronicsOptedIn);
      expect(block?.caption).toBe(entry.caption);
      expect(block?.message).toContain(entry.message);
    });
  }

  it('lets only the post-write recheck ignore the M3 acknowledgement it is waiting for', () => {
    const waiting = { ...readyState(), pendingUntrackedAcks: 1 };
    expect(fireActivationBlock(waiting, neotronicsOptedIn, true)).toBeNull();
    expect(fireActivationBlock({ ...waiting, alarmCode: 2 }, neotronicsOptedIn, true)).toEqual(
      expect.objectContaining({ caption: 'Alarm' }),
    );
  });
});

function withState(state: LaserState, machineState: 'Run'): LaserState['statusReport'] {
  if (state.statusReport === null) throw new Error('ready state has a report');
  return { ...state.statusReport, state: machineState };
}

function withoutPosition(state: LaserState): LaserState['statusReport'] {
  if (state.statusReport === null) throw new Error('ready state has a report');
  return { ...state.statusReport, mPos: null, wPos: null };
}
