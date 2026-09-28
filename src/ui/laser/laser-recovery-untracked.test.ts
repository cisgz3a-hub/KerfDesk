import { describe, expect, it } from 'vitest';
import { buildResumeProgram } from '../../core/controllers/grbl/resume-program';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { initialLaserState } from '../state/laser-store-helpers';
import { ExecutionArtifactTooLargeError } from '../state/recovery/execution-artifact-size';
import { resumeProgressMap, untrackedLaserRecovery } from './laser-recovery-untracked';

const JOB = [
  '; KerfDesk job',
  'G21',
  'G90',
  'M4 S0',
  'G0 X0 Y0',
  'G1 X10 S400 F2000',
  '',
  'G1 Y10',
  '; next shape',
  'G0 X20 Y0',
  'G1 X30 S400',
  'M5',
].join('\n');

const RESUME_OPTIONS = {
  machineKind: 'laser',
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 0,
} as const;

describe('recovery run progress in the job lines', () => {
  it("maps the resume program's lines back onto the job's", () => {
    const resume = buildResumeProgram(JOB, 10, RESUME_OPTIONS);
    if (resume.kind !== 'ok') throw new Error(resume.reason);

    const map = resumeProgressMap(JOB, resume.lines.join('\n'), 10, resume.preambleCount);

    // Job lines before line 10: G21 G90 M4 G0 G1 G1 = 6 sendable.
    expect(map?.jobLinesBefore).toBe(6);
    expect(map?.preambleLines).toBe(
      resume.lines.slice(0, resume.preambleCount).filter((line) => !line.startsWith(';')).length,
    );
  });

  it('gives up when the replayed lines do not match the job one for one', () => {
    const resume = buildResumeProgram(JOB, 10, RESUME_OPTIONS);
    if (resume.kind !== 'ok') throw new Error(resume.reason);
    const shifted = [...resume.lines.slice(0, -1), 'M106 S0', 'M5'].join('\n');

    expect(resumeProgressMap(JOB, shifted, 10, resume.preambleCount)).toBeNull();
    expect(resumeProgressMap(JOB, resume.lines.join('\n'), 0, resume.preambleCount)).toBeNull();
  });

  it('runs a recovery without an archive only when the archive is too large', () => {
    const args = {
      recoveryRunId: 'run-resume',
      jobGcode: JOB,
      resumeGcode: JOB,
      resumeFromLine: 1,
      resumePreambleLines: 0,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      jobOrigin: undefined,
      laser: { ...initialLaserState(), wcoCache: { x: 5, y: 6, z: 0 } },
    };

    expect(untrackedLaserRecovery(new Error('storage failed'), args)).toBeNull();
    expect(untrackedLaserRecovery(new ExecutionArtifactTooLargeError(), args)).toMatchObject({
      record: {
        runId: 'run-resume',
        startWorkOffsetMm: { x: 5, y: 6, z: 0 },
        progress: { jobLinesBefore: 0, preambleLines: 0 },
      },
    });
  });
});
