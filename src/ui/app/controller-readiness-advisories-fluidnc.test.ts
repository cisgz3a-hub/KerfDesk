// ADR-180 Amendment 8: the FluidNC Resume spin-up warning is a Start fact. A
// saved file is never paused by KerfDesk, so Save/export does not repeat it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import { controllerReadinessAdvisories } from './controller-readiness-advisories';

describe('Save/export controller advisories on FluidNC', () => {
  it('leaves out the Resume spin-up warning', () => {
    const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    const rpm = DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm;
    const advisories = controllerReadinessAdvisories(
      project,
      { maxPowerS: rpm, minPowerS: 0 },
      'readonly-dump',
      'fluidnc',
    ).join(' ');

    // The unconfirmed $32 still reaches Save; only the run-time Resume fact is left out.
    expect(advisories).toContain('$32');
    expect(advisories).not.toContain('spinup_ms');
  });
});
