// Job Review power-scale warnings from controller audit v4 E1: FluidNC's whole
// S steps follow the range the job is written for, connected $30 first
// (ADR-567 Amendment 2), and a Marlin inline Full-power S above one byte is
// named (E1-P3-3).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { createProject } from '../../core/scene';
import { laserPowerScaleWarnings, type LaserPowerScaleSource } from './connected-laser-power-scale';
import { detectMachineJobWarnings } from './machine-job-warnings';

const FLUIDNC: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'fluidnc',
  maxPowerS: 255,
};

function connectedFluidnc(maxPowerS: number): LaserPowerScaleSource {
  return {
    connected: true,
    activeControllerKind: 'fluidnc',
    controllerSessionEpoch: 7,
    controllerSettings: { maxPowerS },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 100 },
  };
}

const stepWarning = (warnings: ReadonlyArray<string>) =>
  warnings.find((warning) => warning.startsWith('FluidNC keeps every S word as a whole number'));

describe('Job Review power-scale warnings (audit v4 E1)', () => {
  it('warns from a connected FluidNC $30=20 even when the profile says 255', () => {
    const warnings = laserPowerScaleWarnings(createProject(FLUIDNC), connectedFluidnc(20));
    expect(warnings[0]).toContain("connected controller's $30=20");
    expect(stepWarning(warnings)).toContain("the connected controller's $30=20");
    expect(stepWarning(warnings)).toContain('Power moves in 5% steps');
  });

  it('stays quiet for a connected FluidNC $30=255', () => {
    expect(
      stepWarning(laserPowerScaleWarnings(createProject(FLUIDNC), connectedFluidnc(255))),
    ).toBeUndefined();
  });

  it('warns from the saved FluidNC profile when nothing is connected', () => {
    const project = createProject({ ...FLUIDNC, maxPowerS: 1 });
    expect(stepWarning(laserPowerScaleWarnings(project))).toContain("this profile's Full-power S1");
  });

  it('adds the Marlin one-byte warning to the machine job warnings', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 1000,
      gcodeDialect: { dialectId: 'marlin-inline' },
    });
    expect(
      detectMachineJobWarnings(project).some((warning) =>
        warning.startsWith("This Marlin profile's Full-power S is 1000"),
      ),
    ).toBe(true);
  });
});
