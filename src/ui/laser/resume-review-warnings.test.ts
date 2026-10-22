// Audit v3 D5-P2-4, ADR-232 Amendment 1: a laser resume's confirmation lists
// the no-go zones its own re-entry move crosses, not only the original
// program's. Scene from the audit: B (300..320, 10..30) is cut first, A
// (10..30, 350..370) second, and a rear clamp spans X 100..200, Y 360..400.
// The job stops in A and the operator homes, so the head stands at (390, 390).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { recoveryRepository } from '../state/recovery';
import { buildLaserResumeProgram } from './laser-resume-program';
import { resumeReviewWarnings } from './resume-review-warnings';
import { prepareStartJob } from './start-job-readiness';
import { streamResumeFromRawLine } from './start-job-resume-stream';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const REAR_CLAMP = {
  id: 'rear',
  name: 'Rear clamp',
  enabled: true,
  x: 100,
  y: 360,
  width: 100,
  height: 40,
};
const HOMED_HEAD = { x: 390, y: 390 };
const BED_OFFSET = { x: 0, y: 0 };
const originalStartJob = useLaserStore.getState().startJob;
const startJob = vi.fn(async () => undefined);

function square(id: string, x: number, y: number): SceneObject {
  const points = [
    { x, y },
    { x: x + 20, y },
    { x: x + 20, y: y + 20 },
    { x, y: y + 20 },
  ];
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + 20, maxY: y + 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ points, closed: true }] }],
  };
}

function project(): Project {
  const device: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    origin: 'front-left',
    bedWidth: 400,
    bedHeight: 400,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    noGoZones: [REAR_CLAMP],
  };
  const base = createProject(device);
  // Scene Y runs down: A lands at bed (10..30, 350..370), B at (300..320, 10..30).
  const scene = addObject(addObject(base.scene, square('A', 10, 30)), square('B', 300, 370));
  return { ...base, scene: addLayer(scene, createLayer({ id: 'L1', color: '#ff0000' })) };
}

function homedStatus(): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { ...HOMED_HEAD, z: 0 },
    wPos: null,
    wco: { x: 0, y: 0, z: 0 },
    feed: 0,
    spindle: 0,
  };
}

/** The live controller after homing: a verified stock-GRBL bed mapping. */
function homedController(device: DeviceProfile): LaserState {
  return {
    ...useLaserStore.getState(),
    ...stockNativeEvidence(device, true),
    statusReport: homedStatus(),
    wcoCache: { x: 0, y: 0, z: 0 },
  };
}

/** The 1-based line of A's first lit move, where the job stopped. */
function lineInPartA(gcode: string): number {
  return gcode.split('\n').findIndex((line) => line.startsWith('G1 X30.000 Y370.000')) + 1;
}

describe('resumeReviewWarnings', () => {
  it("adds the re-entry move's crossing that the original program's scan misses", () => {
    const target = project();
    const emitted = emitGcode(target, {
      preflightMotionOffset: BED_OFFSET,
      preflightInitialMachinePosition: HOMED_HEAD,
    });
    const original = emitted.preflight.issues.map((issue) => issue.message);
    // Head → B → A → park never reaches the clamp, so Start-time review is clean.
    expect(original.join('\n')).not.toContain('Rear clamp');
    const resume = buildLaserResumeProgram(
      emitted.gcode,
      lineInPartA(emitted.gcode),
      target.device,
    );
    if (resume.kind === 'error') throw new Error(resume.reason);

    const warnings = resumeReviewWarnings(
      {
        project: target,
        warnings: original,
        preflightMotionOffset: BED_OFFSET,
        controllerSnapshot: homedController(target.device),
      },
      resume,
    );

    expect(warnings).toEqual([
      ...original,
      expect.stringMatching(
        /^The resume's re-entry move \(G0 X10 Y370 S0\) from where the head is now .* no-go zone "Rear clamp"\./,
      ),
    ]);
  });

  it('adds nothing when the bed offset is not trusted or the head is unknown', () => {
    const target = project();
    const gcode = emitGcode(target).gcode;
    const resume = buildLaserResumeProgram(gcode, lineInPartA(gcode), target.device);
    if (resume.kind === 'error') throw new Error(resume.reason);
    const controller = homedController(target.device);

    expect(
      resumeReviewWarnings(
        { project: target, warnings: ['original'], controllerSnapshot: controller },
        resume,
      ),
    ).toEqual(['original']);
    expect(
      resumeReviewWarnings(
        {
          project: target,
          warnings: ['original'],
          preflightMotionOffset: BED_OFFSET,
          controllerSnapshot: { ...controller, homingState: 'unknown' },
        },
        resume,
      ),
    ).toEqual(['original']);
  });
});

describe('manual Start from line', () => {
  beforeEach(() => {
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
    startJob.mockClear();
    vi.spyOn(recoveryRepository, 'noteUntrackedRunAccepted').mockResolvedValue({
      ok: true,
      value: true,
    });
    useLaserStore.setState({
      ...initialLaserState(),
      startJob,
      connection: { kind: 'connected' },
      controllerSessionEpoch: 7,
      controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
      controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
      controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
      statusReport: homedStatus(),
    });
  });

  afterEach(() => {
    useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
    vi.restoreAllMocks();
  });

  it('confirms the re-entry crossing before anything streams', async () => {
    const target = project();
    const job = prepareStartJob(
      target,
      useLaserStore.getState().controllerSettings,
      { statusReport: homedStatus(), alarmCode: null, hasActiveStreamer: false },
      { startFrom: 'absolute', anchor: 'front-left' },
      DEFAULT_OUTPUT_SCOPE,
      undefined,
      false,
    );
    if (!job.ok) throw new Error(job.messages.join('\n'));
    vi.mocked(jobAwareConfirm).mockImplementation((message) => !message.includes('"Rear clamp"'));

    const started = await streamResumeFromRawLine(
      target,
      job.gcode,
      lineInPartA(job.gcode),
      job.canvasPlan,
      captureLaserModeStartSnapshot(useLaserStore.getState()),
      homedController(target.device),
      undefined,
      { warnings: [], preflightMotionOffset: BED_OFFSET },
    );

    expect(started).toBe(false);
    expect(jobAwareConfirm).toHaveBeenCalledWith(
      expect.stringMatching(/^Controller warning:[\s\S]*re-entry move[\s\S]*"Rear clamp"/),
    );
    expect(startJob).not.toHaveBeenCalled();
  });
});
