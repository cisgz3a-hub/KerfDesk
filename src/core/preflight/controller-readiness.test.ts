import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createProject } from '../scene';
import { runControllerReadiness } from './controller-readiness';

const controllerOk = {
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
};

describe('runControllerReadiness', () => {
  it('passes when the connected controller matches the project power scale', () => {
    const result = runControllerReadiness(createProject(), controllerOk);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('blocks live Start when controller settings have not been confirmed', () => {
    const result = runControllerReadiness(createProject(), null);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: 'controller-settings-unknown',
      message:
        'Controller settings are not confirmed yet. Connect to the laser and wait for $$ detection before starting.',
    });
  });

  it('blocks live Start when GRBL $30 differs from the project max S profile', () => {
    const result = runControllerReadiness(createProject(), {
      ...controllerOk,
      maxPowerS: 255,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: 'max-power-mismatch',
      message:
        'Controller $30 is 255 but this project is set to max S 1000. Apply the detected setting before starting.',
    });
  });

  it('blocks live Start when the controller does not report GRBL $30', () => {
    const result = runControllerReadiness(createProject(), {
      minPowerS: 0,
      laserModeEnabled: true,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: 'max-power-unknown',
      message:
        'Controller did not report GRBL $30 max S. KerfDesk cannot prove that power percentages map safely.',
    });
  });

  it('blocks live Start when GRBL laser mode is disabled', () => {
    const result = runControllerReadiness(createProject(), {
      ...controllerOk,
      laserModeEnabled: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: 'laser-mode-disabled',
      message:
        'Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from KerfDesk.',
    });
  });

  it('warns, but does not block, when GRBL $31 minimum S is nonzero', () => {
    const result = runControllerReadiness(createProject(), {
      ...controllerOk,
      minPowerS: 10,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({
      code: 'min-power-nonzero',
      message:
        'Controller $31 minimum S is 10. Low nonzero power values may burn hotter than expected.',
    });
  });

  it('uses the project max S value, not the default, when checking mismatches', () => {
    const project = createProject({ ...DEFAULT_DEVICE_PROFILE, maxPowerS: 255 });

    expect(runControllerReadiness(project, { ...controllerOk, maxPowerS: 255 }).ok).toBe(true);
  });
});
