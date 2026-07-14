import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type Project } from '../../core/scene';
import { CNC_NO_WORK_ZERO_START_MESSAGE, cncWorkZeroStartIssue } from './cnc-start-advisories';

const cncProject: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const laserProject: Project = createProject(); // default machine is laser

describe('cncWorkZeroStartIssue', () => {
  it('blocks when a CNC job has no current work-Z evidence', () => {
    expect(cncWorkZeroStartIssue(cncProject, null, 7)).toBe(CNC_NO_WORK_ZERO_START_MESSAGE);
    expect(cncWorkZeroStartIssue(cncProject, undefined, 7)).toBe(CNC_NO_WORK_ZERO_START_MESSAGE);
    expect(cncWorkZeroStartIssue(cncProject, { source: 'probe', referenceEpoch: 6 }, 7)).toBe(
      CNC_NO_WORK_ZERO_START_MESSAGE,
    );
  });

  it('is silent only for evidence bound to the current work-Z reference epoch', () => {
    expect(
      cncWorkZeroStartIssue(cncProject, { source: 'manual-zero', referenceEpoch: 7 }, 7),
    ).toBeNull();
  });

  it('is silent for laser jobs (no stock-top Z contract)', () => {
    expect(cncWorkZeroStartIssue(laserProject, null, 7)).toBeNull();
    expect(cncWorkZeroStartIssue(laserProject, undefined, 7)).toBeNull();
  });
});
