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

describe('convertedLaserSuspicion (ADR-637 Amendments 8 and 10)', () => {
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

  // 1.0.29's own `$30` advisory said "Set $30=12000 (or update the machine
  // profile)", and its setup offered the S maximum as the spindle RPM: those
  // edits are not an answer (rolling audit v12 X2-P1-2).
  it.each([
    ['max RPM set to the S scale', { spindleMaxRpm: 1000 }],
    ['max RPM raised', { spindleMaxRpm: 24000 }],
    ['no spin-up', { spindleSpinupSec: 0 }],
    ['coolant', { coolant: 'mist' as const }],
  ])('still asks after the spindle was edited (%s)', (_name, params) => {
    expect(
      convertedLaserSuspicion({
        profile: STARTER_MADE_CNC,
        machine: cncWith(params),
        controller: STOCK_GRBL_DIODE,
      }),
    ).not.toBeNull();
  });

  it('still asks when the controller $30 was written to a spindle scale, naming no laser scale', () => {
    expect(
      convertedLaserSuspicion({
        profile: STARTER_MADE_CNC,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        controller: { laserModeEnabled: false, maxPowerS: 12000 },
      }),
    ).toEqual({ hints: [{ kind: 'laser-mode', enabled: false }] });
  });

  it('asks about the other lasers 1.0.29 converted: a LightBurn import and a profile with no id', () => {
    const lightburn: DeviceProfile = {
      ...STARTER_MADE_CNC,
      name: 'Shop diode 10W',
      profileId: 'lightburn-shop-diode-10w',
      profileSource: 'lightburn',
    };
    const { profileId: _id, ...noId } = STARTER_MADE_CNC;
    for (const profile of [lightburn, noId]) {
      expect(convertedLaserSuspicion({ profile, machine: DEFAULT_CNC_MACHINE_CONFIG })).toEqual({
        hints: [],
      });
    }
  });

  it("does not ask about a listed machine, a two-tool profile, or the toolbar's CNC on the plain starter", () => {
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
});
