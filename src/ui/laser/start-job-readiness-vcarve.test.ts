import { describe, expect, it } from 'vitest';
import { flowingVCarveProject } from '../../__fixtures__/flowing-vcarve-project';
import type { StatusReport } from '../../core/controllers/grbl';
import { prepareStartJob } from './start-job-readiness';
import { frameVerificationForProject } from './frame-verification-testing';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

describe('prepareStartJob flowing V-carve warnings', () => {
  it('includes the actual compiled flowing V-carve depth in Start warnings', () => {
    const project = flowingVCarveProject();
    const result = prepareStartJob(
      project,
      { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
      {
        statusReport: idleStatus,
        alarmCode: null,
        hasActiveStreamer: false,
        frameVerification: frameVerificationForProject(project),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.warnings.some(
          (warning) =>
            warning.includes('actual compiled V-carve depth') &&
            warning.includes('into the spoilboard'),
        ),
      ).toBe(true);
    }
  });
});
