import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../core/scene';
import { CNC_NO_WORK_ZERO_ADVISORY, cncWorkZeroAdvisory } from './cnc-start-advisories';

const cncProject: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const laserProject: Project = createProject(); // default machine is laser

describe('cncWorkZeroAdvisory', () => {
  it('advises when a CNC job has no current work-Z evidence', () => {
    expect(cncWorkZeroAdvisory(cncProject, null, 7)).toBe(CNC_NO_WORK_ZERO_ADVISORY);
    expect(cncWorkZeroAdvisory(cncProject, undefined, 7)).toBe(CNC_NO_WORK_ZERO_ADVISORY);
    expect(cncWorkZeroAdvisory(cncProject, { source: 'probe', referenceEpoch: 6 }, 7)).toBe(
      CNC_NO_WORK_ZERO_ADVISORY,
    );
  });

  it('is silent only for evidence bound to the current work-Z reference epoch', () => {
    expect(
      cncWorkZeroAdvisory(cncProject, { source: 'manual-zero', referenceEpoch: 7 }, 7),
    ).toBeNull();
  });

  it('is silent for laser jobs (no stock-top Z contract)', () => {
    expect(cncWorkZeroAdvisory(laserProject, null, 7)).toBeNull();
    expect(cncWorkZeroAdvisory(laserProject, undefined, 7)).toBeNull();
  });
});
