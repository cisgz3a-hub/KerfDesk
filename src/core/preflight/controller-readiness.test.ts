import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../scene';
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

  it('warns without blocking laser Start when controller settings have not been confirmed', () => {
    const result = runControllerReadiness(createProject(), null);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'power-scale-unverified',
      'laser-mode-unverified',
    ]);
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

  it('warns without blocking laser Start when the controller does not report GRBL $30', () => {
    const result = runControllerReadiness(createProject(), {
      minPowerS: 0,
      laserModeEnabled: true,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain('power-scale-unverified');
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

  // Audit F6: FluidNC ('readonly-dump') DOES report numeric $-settings via
  // its $$ compat dump — lumping it with Marlin ('none') skipped a
  // verification the app already had the data for. Reported values are
  // verified strictly; only ABSENT values downgrade to a warning (a compat
  // dump is not guaranteed complete, and the app cannot write the fix).
  describe('readonly-dump firmwares (FluidNC)', () => {
    it('blocks Start when the reported $30 mismatches the project scale', () => {
      const result = runControllerReadiness(
        createProject(),
        { ...controllerOk, maxPowerS: 255 },
        'readonly-dump',
      );

      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => e.code)).toContain('max-power-mismatch');
    });

    it('blocks Start when the dump reports laser mode disabled', () => {
      const result = runControllerReadiness(
        createProject(),
        { ...controllerOk, laserModeEnabled: false },
        'readonly-dump',
      );

      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => e.code)).toContain('laser-mode-disabled');
    });

    it('warns instead of blocking when the dump omits $30 or $32', () => {
      const result = runControllerReadiness(createProject(), {}, 'readonly-dump');

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.map((w) => w.code)).toContain('power-scale-unverified');
      expect(result.warnings.map((w) => w.code)).toContain('laser-mode-unverified');
    });

    it('passes cleanly when the dump confirms the scale and laser mode', () => {
      const result = runControllerReadiness(createProject(), controllerOk, 'readonly-dump');

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("firmwares with NO settings dump keep ADR-095's warning-only path", () => {
      const result = runControllerReadiness(createProject(), null, 'none');

      expect(result.ok).toBe(true);
      expect(result.warnings.map((w) => w.code)).toContain('power-scale-unverified');
    });
  });

  describe('cnc/router projects', () => {
    // A correctly configured router: $32=0 and $30 = spindle max RPM
    // (12000, DEFAULT_CNC_MACHINE_PARAMS). The laser gate used to block
    // exactly this state and advise enabling $32=1.
    const cncProject = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    const routerOk = { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false };

    it('passes a correctly configured router ($32=0, $30 = spindle max RPM)', () => {
      const result = runControllerReadiness(cncProject, routerOk);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('keeps Start blocked when CNC controller settings are not confirmed', () => {
      const result = runControllerReadiness(cncProject, null);

      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: 'controller-settings-unknown',
        message:
          'Controller settings are not confirmed yet. Reconnect or retry reading settings before starting CNC output.',
      });
    });

    it('blocks CNC Start when laser mode is ENABLED, advising $32=0', () => {
      const result = runControllerReadiness(cncProject, { ...routerOk, laserModeEnabled: true });

      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => e.code)).toContain('laser-mode-enabled');
      const message = result.errors.find((e) => e.code === 'laser-mode-enabled')?.message ?? '';
      expect(message).toContain('$32=0');
    });

    it('blocks CNC Start when $30 does not match the spindle max RPM', () => {
      // 1000 is the laser S scale — a router left on it would treat S values
      // as if 1000 RPM were full speed.
      const result = runControllerReadiness(cncProject, { ...routerOk, maxPowerS: 1000 });

      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => e.code)).toContain('spindle-scale-mismatch');
      expect(result.errors.find((e) => e.code === 'spindle-scale-mismatch')?.message).toContain(
        '12000',
      );
    });

    it('never demands laser mode ($32=1) for a cnc machine', () => {
      const result = runControllerReadiness(cncProject, { ...routerOk, laserModeEnabled: false });

      expect(result.errors.map((e) => e.code)).not.toContain('laser-mode-disabled');
    });
  });
});
