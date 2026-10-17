import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { generateFocusTest } from '../../core/job/focus-test';
import { createProject, DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { recoveryRepository } from '../state/recovery';
import { buildLaserResumeProgram } from './laser-resume-program';
import { prepareStartJob } from './start-job-readiness';
import { streamResumeFromRawLine } from './start-job-resume-stream';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const startJob = vi.fn(async () => undefined);
const status = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
};

function focusProject(zero: boolean): Project {
  const scene = generateFocusTest({
    steps: 3,
    minOffsetMm: -1,
    maxOffsetMm: 1,
    lineLengthMm: 20,
    spacingMm: 3,
    speed: 1200,
    power: 10,
    travelFeedMmPerMin: 300,
  });
  return {
    ...createProject(),
    scene: zero
      ? {
          ...scene,
          layers: scene.layers.map((layer) => ({
            ...layer,
            focusTest: { offsetMm: 0, travelFeedMmPerMin: 300 },
          })),
        }
      : scene,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(recoveryRepository, 'noteUntrackedRunAccepted').mockResolvedValue({
    ok: true,
    value: true,
  });
  useLaserStore.setState({
    ...initialLaserState(),
    startJob,
    connection: { kind: 'connected' },
    statusReport: status,
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
  });
});

afterEach(() => {
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('Focus resume artifact semantics', () => {
  it('allows only the selected zero sample even when the source contains nonzero Focus offsets', () => {
    const project = focusProject(false);
    const gcode = emitGcode(project, {
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['focus-test-2-line'],
      },
    }).gcode;
    expect(gcode).toContain('; Focus Test Z offset 0.000');
    expect(gcode).not.toMatch(/G1 Z/);
    const burnLine = gcode.split('\n').findIndex((line) => /^G1 X/.test(line)) + 1;
    expect(burnLine).toBeGreaterThan(0);
    expect(buildLaserResumeProgram(gcode, burnLine, project.device).kind).toBe('ok');
  });

  it('allows emitted zero-offset Focus output through the shared recovery builder', () => {
    const project = focusProject(true);
    const gcode = emitGcode(project).gcode;
    expect(gcode).toContain('; Focus Test Z offset 0.000');
    expect(gcode).not.toMatch(/G1 Z/);
    expect(buildLaserResumeProgram(gcode, 1, project.device).kind).toBe('ok');
  });

  it.each(['; G91 G1 Z2', '(G91 G1 Z2)', 'G91\nG1 Z0\nG90', 'G91\nG92 Z2\nG90'])(
    'does not interpret comments, zero increments or coordinate settings as Focus Z motion: %s',
    (extra) => {
      const gcode =
        '; Focus Test Z offset 0.000 mm from starting focus\nG21\nG90\n' +
        extra +
        '\nM4 S0\nG1 X1 Y1 F300 S20\nM5';
      expect(buildLaserResumeProgram(gcode, 1, DEFAULT_DEVICE_PROFILE).kind).toBe('ok');
    },
  );

  it.each(['G91\nG1 Z-1 F300 S0', 'G91G1Z+.5F300S0', 'G91\nG1 X0\nZ1', 'G20 G91 G1 Z.001'])(
    'refuses actual relative Z even when a zero-valued marker is retained: %s',
    (motion) => {
      const gcode = '; Focus Test Z offset 0.000 mm from starting focus\n' + motion + '\nG90\nM5';
      expect(buildLaserResumeProgram(gcode, 1, DEFAULT_DEVICE_PROFILE)).toMatchObject({
        kind: 'error',
        reason: expect.stringContaining('original starting Z focus'),
      });
    },
  );
});

describe('manual Focus start-from-line', () => {
  it.each([true, false])(
    'uses the same artifact guard before any stream (zero offsets=%s)',
    async (zero) => {
      const project = focusProject(zero);
      const job = prepareStartJob(
        project,
        useLaserStore.getState().controllerSettings,
        { statusReport: status, alarmCode: null, hasActiveStreamer: false },
        { startFrom: 'absolute', anchor: 'front-left' },
        DEFAULT_OUTPUT_SCOPE,
        undefined,
        false,
      );
      if (!job.ok) throw new Error(job.messages.join('\n'));
      const started = await streamResumeFromRawLine(
        project,
        job.gcode,
        1,
        job.canvasPlan,
        captureLaserModeStartSnapshot(useLaserStore.getState()),
      );
      expect(started).toBe(zero);
      if (zero) {
        expect(startJob).toHaveBeenCalledOnce();
        expect(jobAwareAlert).not.toHaveBeenCalled();
      } else {
        expect(startJob).not.toHaveBeenCalled();
        expect(jobAwareConfirm).not.toHaveBeenCalled();
        expect(recoveryRepository.noteUntrackedRunAccepted).not.toHaveBeenCalled();
        expect(jobAwareAlert).toHaveBeenCalledWith(
          expect.stringContaining('original starting Z focus'),
        );
      }
    },
  );
});
