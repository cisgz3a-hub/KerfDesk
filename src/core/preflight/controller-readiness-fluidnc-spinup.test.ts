// ADR-180 Amendment 8 (rolling audit v11 W2-P2-1): a FluidNC router job states
// at Start that Resume waits only spinup_ms, so the warning reaches every Start
// route, the phone review included, before anything is paused.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../scene';
import { runControllerReadiness } from './controller-readiness';
import { FLUIDNC_RESUME_SPINUP_MESSAGE } from './controller-readiness-messages';

const cncProject = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const rpm = DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm;
const router = { maxPowerS: rpm, minPowerS: 0, laserModeEnabled: false };
const codes = (result: ReturnType<typeof runControllerReadiness>) =>
  result.warnings.map((warning) => warning.code);

describe('FluidNC Resume spin-up at Start', () => {
  it('warns a FluidNC router job at $32=0 that Resume waits only spinup_ms', () => {
    const result = runControllerReadiness(cncProject, router, 'readonly-dump', 'fluidnc');

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({
      code: 'fluidnc-resume-spinup',
      message: FLUIDNC_RESUME_SPINUP_MESSAGE,
    });
    expect(FLUIDNC_RESUME_SPINUP_MESSAGE).toContain('spinup_ms');
    expect(FLUIDNC_RESUME_SPINUP_MESSAGE).toContain('ABORT JOB');
  });

  it('warns on the FluidNC dump alone, and with $32 unconfirmed', () => {
    expect(codes(runControllerReadiness(cncProject, router, 'readonly-dump'))).toContain(
      'fluidnc-resume-spinup',
    );
    expect(codes(runControllerReadiness(cncProject, {}, 'readonly-dump', 'fluidnc'))).toEqual([
      'power-scale-unverified',
      'laser-mode-unverified',
      'fluidnc-resume-spinup',
    ]);
  });

  it('leaves $32=1 to the laser-mode refusal, which already names Resume', () => {
    const result = runControllerReadiness(
      cncProject,
      { ...router, laserModeEnabled: true },
      'readonly-dump',
      'fluidnc',
    );

    expect(codes(result)).not.toContain('fluidnc-resume-spinup');
    expect(result.errors.map((error) => error.message).join('\n')).toContain(
      'Resume after a pause restarts motion with no spin-up',
    );
  });

  it('keeps GRBL, grblHAL and laser jobs unchanged', () => {
    for (const kind of ['grbl-v1.1', 'grblhal'] as const) {
      expect(codes(runControllerReadiness(cncProject, router, 'grbl-dollar', kind))).toEqual([]);
    }
    const laser = runControllerReadiness(
      createProject(),
      { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
      'readonly-dump',
      'fluidnc',
    );
    expect(codes(laser)).not.toContain('fluidnc-resume-spinup');
  });
});
