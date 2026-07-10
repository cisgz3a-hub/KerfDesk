import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../core/scene';
import { CNC_NO_WORK_ZERO_ADVISORY, cncWorkZeroAdvisory } from './cnc-start-advisories';

const cncProject: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const laserProject: Project = createProject(); // default machine is laser

describe('cncWorkZeroAdvisory', () => {
  it('advises when a CNC job starts with no active work origin', () => {
    expect(cncWorkZeroAdvisory(cncProject, false)).toBe(CNC_NO_WORK_ZERO_ADVISORY);
    expect(cncWorkZeroAdvisory(cncProject, undefined)).toBe(CNC_NO_WORK_ZERO_ADVISORY);
  });

  it('is silent once a work origin / Zero-Z is active', () => {
    expect(cncWorkZeroAdvisory(cncProject, true)).toBeNull();
  });

  it('is silent for laser jobs (no stock-top Z contract)', () => {
    expect(cncWorkZeroAdvisory(laserProject, false)).toBeNull();
    expect(cncWorkZeroAdvisory(laserProject, undefined)).toBeNull();
  });
});
