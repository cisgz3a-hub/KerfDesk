import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG, type CncMachineConfig } from '../scene';
import { convertedLaserSuspicion } from './converted-laser-profile';

// The laser starter as 1.0.29's `$32=0` fill saved it: the starter's id, CNC
// as its only output, KerfDesk's spindle defaults (rolling audit v10 V2-P2-2).
const STARTER_MADE_CNC: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  capabilities: [
    ...(DEFAULT_DEVICE_PROFILE.capabilities ?? []).filter((c) => c !== 'laser-output'),
    'cnc-output',
  ],
};
const STOCK_GRBL_DIODE = { laserModeEnabled: false, maxPowerS: 1000, protocolVersion: '1.1h' };

function cncWith(params: Partial<CncMachineConfig['params']>): CncMachineConfig {
  return {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, ...params },
  };
}

describe('convertedLaserSuspicion (ADR-637 Amendment 8)', () => {
  it("asks about the laser starter 1.0.29 saved as a CNC, naming the controller's laser hints", () => {
    expect(
      convertedLaserSuspicion({
        profile: STARTER_MADE_CNC,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        controller: STOCK_GRBL_DIODE,
      }),
    ).toEqual({
      hints: [
        { kind: 'laser-mode', enabled: false },
        { kind: 'laser-power-scale', maxPowerS: 1000 },
        { kind: 'grbl-1-1', protocolVersion: '1.1h' },
      ],
    });
  });

  it('asks before any controller is read, with no hints, and with laser mode on', () => {
    expect(
      convertedLaserSuspicion({ profile: STARTER_MADE_CNC, machine: DEFAULT_CNC_MACHINE_CONFIG }),
    ).toEqual({ hints: [] });
    expect(
      convertedLaserSuspicion({
        profile: STARTER_MADE_CNC,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        controller: { laserModeEnabled: true },
      }),
    ).toEqual({ hints: [{ kind: 'laser-mode', enabled: true }] });
  });

  it('never asks about a laser', () => {
    expect(
      convertedLaserSuspicion({
        profile: DEFAULT_DEVICE_PROFILE,
        machine: LASER_MACHINE_CONFIG,
        controller: STOCK_GRBL_DIODE,
      }),
    ).toBeNull();
    expect(convertedLaserSuspicion({ profile: STARTER_MADE_CNC, machine: undefined })).toBeNull();
  });

  it.each([
    ['max RPM', { spindleMaxRpm: 24000 }],
    ['spin-up', { spindleSpinupSec: 5 }],
    ['coolant', { coolant: 'mist' as const }],
  ])('does not ask once someone set the spindle (%s)', (_name, params) => {
    expect(
      convertedLaserSuspicion({
        profile: STARTER_MADE_CNC,
        machine: cncWith(params),
        controller: STOCK_GRBL_DIODE,
      }),
    ).toBeNull();
  });

  it("does not ask about another machine, a two-tool starter, or the toolbar's CNC on the plain starter", () => {
    const listed = { ...STARTER_MADE_CNC, profileId: 'generic-3018-router' };
    const twoTools: DeviceProfile = {
      ...STARTER_MADE_CNC,
      capabilities: [...(STARTER_MADE_CNC.capabilities ?? []), 'laser-output'],
    };
    // The plain starter declares no output kind: 1.0.29's Save always did.
    for (const profile of [listed, twoTools, DEFAULT_DEVICE_PROFILE]) {
      expect(convertedLaserSuspicion({ profile, machine: DEFAULT_CNC_MACHINE_CONFIG })).toBeNull();
    }
  });

  it("does not ask when the controller's $30 is a spindle's RPM, and does at a laser scale", () => {
    const ask = (maxPowerS: number) =>
      convertedLaserSuspicion({
        profile: STARTER_MADE_CNC,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        controller: { laserModeEnabled: false, maxPowerS },
      });
    expect(ask(12000)).toBeNull();
    expect(ask(1001)).toBeNull();
    expect(ask(1000)).not.toBeNull();
    expect(ask(255)).not.toBeNull();
  });
});
