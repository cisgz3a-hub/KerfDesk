// ADR-483 (LightBurn gap LBG-M02): the laser finish position, end to end. Each
// case runs the real placement resolution, preparation and emission, then
// checks that the G-code's last move, Job Review's park target and park note,
// the preview's final travel and the estimate all describe the same move. The
// finish is typed in canvas coordinates and placed through the same bed
// translation as the CNC park (ADR-392), so it lands on one bed spot whichever
// mode places the job, or is set aside when that spot is unknown.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords } from '../../core/devices';
import type { LaserFinishPosition } from '../../core/devices/device-profile';
import type { JobOriginPlacement } from '../../core/job';
import { finishOptionsForJobOrigin, selectOutputStrategy } from '../../core/output';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { Vec2 } from '../../core/scene';
import { emitGcode, emitPreparedGcode, prepareOutput } from '../../io/gcode';
import type { PrepareOutputOptions } from '../../io/gcode/prepare-output';
import { resolveJobPlacement, runtimeCoordinatePreparationOptions } from '../job-placement';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { buildPreviewToolpathFromPrepared } from '../workspace/draw-preview';
import {
  detectParkOutsideFrameWarningsFromMetrics,
  parkOutsideFrameWarning,
} from './job-review/park-outside-frame-warnings';
import { laserFinishSetAsideWarning } from './laser-finish-set-aside-warnings';
import { estimateLiveJobFromPrepared } from './live-job-estimate';
import { detectMachineJobWarnings } from './machine-job-warnings';
import { buildPreparedJobMetrics } from './prepared-job-metrics';

// Canvas (10, 0): 10 mm from the left, on the back edge.
const CANVAS_FINISH = { x: 10, y: 0 };
const BED_FINISH: LaserFinishPosition = { kind: 'bed', xMm: 10, yMm: 0 };
const UNPLACED_NOTE = laserFinishSetAsideWarning(10, 0, 'unplaced', true);

function laserProject(finish: LaserFinishPosition | undefined): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    origin: 'front-left',
    bedWidth: 358,
    bedHeight: 268,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    ...(finish === undefined ? {} : { laserFinishPosition: finish }),
  });
  const square = [
    { x: 100, y: 100 },
    { x: 120, y: 100 },
    { x: 120, y: 120 },
    { x: 100, y: 120 },
  ];
  return {
    ...base,
    scene: {
      layers: [createLayer({ id: 'cut', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds: { minX: 100, minY: 100, maxX: 120, maxY: 120 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#ff0000', polylines: [{ closed: true, points: square }] }],
        },
      ],
    },
  };
}

// Stock GRBL homed to the back-right corner: native (0, 0) is bed (358, 268),
// so a G54 at native (-300, -100) puts work zero at bed (58, 168).
function homedWithOrigin(project: Project) {
  const wco = { x: -300, y: -100, z: 0 };
  return {
    ...stockNativeEvidence(project.device),
    alarmCode: null,
    hasActiveStreamer: false,
    workOriginActive: true,
    wcoCache: wco,
    statusReport: {
      state: 'Idle' as const,
      subState: null,
      mPos: { x: -308, y: -238, z: 0 },
      wPos: { x: -8, y: -138, z: 0 },
      wco,
      feed: 0,
      spindle: 0,
    },
  };
}

// Connected but never homed: the head's work position is known, its bed spot is not.
function unhomedWithOrigin(project: Project) {
  const { controllerSettings: _settings, homingState: _homing, ...rest } = homedWithOrigin(project);
  return rest;
}

type Mode = { readonly options: PrepareOutputOptions; readonly jobOrigin?: JobOriginPlacement };

function placed(
  project: Project,
  startFrom: 'absolute' | 'user-origin' | 'current-position',
  machine: ReturnType<typeof homedWithOrigin> | ReturnType<typeof unhomedWithOrigin>,
): Mode {
  const placement = resolveJobPlacement({ startFrom, anchor: 'front-left' }, machine);
  if (!placement.ok) throw new Error('placement fixture');
  const options = runtimeCoordinatePreparationOptions(project.device, placement, machine);
  return placement.jobOrigin === undefined
    ? { options }
    : { options: { ...options, jobOrigin: placement.jobOrigin }, jobOrigin: placement.jobOrigin };
}

// The postamble: every line after the final M5. A park is one `G0 X Y S0`.
function parkFromGcode(gcode: string): Vec2 | null {
  const lines = gcode.trim().split('\n');
  const tail = lines.slice(lines.lastIndexOf('M5') + 1);
  if (tail.length === 0) return null;
  const match = /^G0 X(\S+) Y(\S+) S0$/.exec(tail.join('\n'));
  if (match === null) throw new Error(`unexpected postamble: ${tail.join(' | ')}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

type Prepared = Extract<ReturnType<typeof prepareOutput>, { readonly ok: true }>;

// Job Review's park target and its outside-the-frame note read the G-code's move.
function expectReviewAgrees(prepared: Prepared, mode: Mode, park: Vec2 | null) {
  const metrics = buildPreparedJobMetrics(prepared, mode.jobOrigin);
  expect(metrics.parkTarget).toEqual(park);
  const bounds = metrics.frameMotionBounds;
  const outside =
    park !== null &&
    bounds !== null &&
    (park.x < bounds.minX || park.x > bounds.maxX || park.y < bounds.minY || park.y > bounds.maxY);
  expect(detectParkOutsideFrameWarningsFromMetrics(bounds, metrics.parkTarget)).toEqual(
    outside ? [parkOutsideFrameWarning(park)] : [],
  );
  // The live Time tile and Job Review's estimate time the same program.
  const live = estimateLiveJobFromPrepared(prepared, mode.jobOrigin);
  expect(live.kind === 'estimated' ? live.totalSeconds : null).toBe(metrics.duration.totalSeconds);
}

// The preview draws the same final move, mapped back onto the canvas.
function expectPreviewAgrees(project: Project, prepared: Prepared, mode: Mode, park: Vec2 | null) {
  const last = buildPreviewToolpathFromPrepared(project, prepared, mode.jobOrigin).steps.at(-1);
  if (park === null) {
    expect(last?.kind).toBe('cut');
    return last;
  }
  const offset = prepared.jobOriginOffset;
  const expected = toSceneCoords({ x: park.x - offset.x, y: park.y - offset.y }, project.device);
  expect(last?.kind === 'travel' ? last.to : null).toEqual(expected);
  return last;
}

/** Run every consumer on one prepared job and prove they agree. */
function runWorkflow(project: Project, mode: Mode) {
  const prepared = prepareOutput(project, mode.options);
  if (!prepared.ok) throw new Error('preparation fixture');
  const { gcode } = emitPreparedGcode(prepared, mode.options);
  expect(emitGcode(project, mode.options).gcode).toBe(gcode);
  const park = parkFromGcode(gcode);
  expectReviewAgrees(prepared, mode, park);
  const previewEnd = expectPreviewAgrees(project, prepared, mode, park);
  const notes = detectMachineJobWarnings(project, null, null, prepared);
  return { prepared, gcode, park, notes, previewEnd };
}

describe('laser finish position, whole workflow (ADR-483)', () => {
  it('Absolute with zero WCO: canvas Y 0 (the back edge) ends at machine Y = bed height', () => {
    const project = laserProject(BED_FINISH);
    const run = runWorkflow(project, { options: {} });

    expect(run.park).toEqual({ x: 10, y: 268 });
    expect(run.gcode.trim().split('\n').at(-1)).toBe('G0 X10.000 Y268.000 S0');
    expect(run.previewEnd?.kind === 'travel' ? run.previewEnd.to : null).toEqual(CANVAS_FINISH);
    expect(run.notes).not.toContain(UNPLACED_NOTE);
  });

  it('Absolute with a known WCO: the finish shifts with the cuts', () => {
    const project = laserProject(BED_FINISH);
    const mode = placed(project, 'absolute', homedWithOrigin(project));
    expect(mode.options.absoluteProgramOffset).toEqual({ x: -58, y: -168 });

    const run = runWorkflow(project, mode);

    // Bed (10, 268) less work zero at bed (58, 168).
    expect(run.park).toEqual({ x: -48, y: 100 });
    expect(run.previewEnd?.kind === 'travel' ? run.previewEnd.to : null).toEqual(CANVAS_FINISH);
    expect(run.notes).not.toContain(UNPLACED_NOTE);
  });

  it('User Origin with work zero known on the bed: the same bed spot as Absolute', () => {
    const project = laserProject(BED_FINISH);
    const mode = placed(project, 'user-origin', homedWithOrigin(project));
    expect(mode.options.workZeroBedPosition).toEqual({ x: 58, y: 168 });

    const run = runWorkflow(project, mode);

    expect(run.park).toEqual({ x: -48, y: 100 });
    expect(run.notes).not.toContain(UNPLACED_NOTE);
  });

  it('User Origin with work zero unknown: the default park, and Job Review says why', () => {
    const project = laserProject(BED_FINISH);
    const jobOrigin: JobOriginPlacement = { startFrom: 'user-origin', anchor: 'front-left' };
    const run = runWorkflow(project, { options: { jobOrigin }, jobOrigin });

    expect(run.park).toEqual({ x: 0, y: 0 });
    // Never the bed numbers read as program coordinates.
    expect(run.gcode).not.toContain('X10.000 Y0.000');
    expect(run.gcode).not.toContain('X10.000 Y268.000');
    expect(run.notes).toContain(UNPLACED_NOTE);
    expect(run.gcode).toBe(runWorkflow(laserProject(undefined), { options: { jobOrigin } }).gcode);
  });

  it('Current Position placed on the bed: the finish wins over the return to the start', () => {
    const project = laserProject(BED_FINISH);
    const mode = placed(project, 'current-position', homedWithOrigin(project));
    expect(mode.options.workZeroBedPosition).toEqual({ x: 58, y: 168 });

    const run = runWorkflow(project, mode);

    expect(run.park).toEqual({ x: -48, y: 100 });
    expect(run.notes).not.toContain(UNPLACED_NOTE);
  });

  it('Current Position not placed on the bed: back to the start, with the note', () => {
    const project = laserProject(BED_FINISH);
    const mode = placed(project, 'current-position', unhomedWithOrigin(project));
    expect(mode.options.workZeroBedPosition).toBeUndefined();

    const run = runWorkflow(project, mode);

    expect(run.park).toEqual({ x: -8, y: -138 });
    expect(run.notes).toContain(UNPLACED_NOTE);
  });

  it('stay: no park move in any mode, Current Position included', () => {
    const project = laserProject({ kind: 'stay' });
    const modes: ReadonlyArray<Mode> = [
      { options: {} },
      placed(project, 'absolute', homedWithOrigin(project)),
      placed(project, 'user-origin', homedWithOrigin(project)),
      placed(project, 'current-position', homedWithOrigin(project)),
      placed(project, 'current-position', unhomedWithOrigin(project)),
    ];
    for (const mode of modes) {
      const run = runWorkflow(project, mode);
      expect(run.park).toBeNull();
      expect(run.gcode.trim().split('\n').at(-1)).toBe('M5');
      expect(run.notes).toEqual(
        detectMachineJobWarnings(laserProject(undefined), null, null, run.prepared),
      );
    }
  });
});

describe('laser finish position absent: byte-identical to the placement default', () => {
  const project = laserProject(undefined);
  const modes: ReadonlyArray<readonly [string, Mode]> = [
    ['Absolute, zero WCO', { options: {} }],
    ['Absolute, known WCO', placed(project, 'absolute', homedWithOrigin(project))],
    ['User Origin, known', placed(project, 'user-origin', homedWithOrigin(project))],
    [
      'User Origin, unknown',
      {
        options: { jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' } },
        jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
      },
    ],
    ['Current Position', placed(project, 'current-position', homedWithOrigin(project))],
  ];

  it.each(modes)('%s', (_label, mode) => {
    const run = runWorkflow(project, mode);
    expect('laserFinish' in run.prepared.job).toBe(false);
    // The pre-ADR-483 call: the placement's own finish options on the same job.
    const legacy = selectOutputStrategy(project.device).emit(
      run.prepared.job,
      project.device,
      finishOptionsForJobOrigin(mode.jobOrigin),
    );
    expect(run.gcode).toBe(legacy);
    expect(run.park).toEqual(
      mode.jobOrigin?.startFrom === 'current-position'
        ? mode.jobOrigin.currentPosition
        : { x: 0, y: 0 },
    );
  });
});
