import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareStartJob } from './start-job-readiness';

type Accessories = NonNullable<StatusReport['accessories']>;

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const allOff: Accessories = {
  spindleCw: false,
  spindleCcw: false,
  flood: false,
  mist: false,
};

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'accessory-line',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
        },
      ],
    },
  ],
};

// Frame-first (ADR-228): accessory state never blocks Start; the demoted
// messages land in the ok-result warnings for the Job Review. The projects
// must compile so the framed prepare reaches the warning collection.
const cncProject: Project = {
  ...createProject(),
  machine: DEFAULT_CNC_MACHINE_CONFIG,
  scene: {
    ...EMPTY_SCENE,
    objects: [lineObject],
    layers: [createLayer({ id: 'L1', color: '#ff0000' })],
  },
};
const laserProject: Project = {
  ...createProject(),
  scene: {
    ...EMPTY_SCENE,
    objects: [lineObject],
    layers: [createLayer({ id: 'L1', color: '#ff0000' })],
  },
};

function warningsOf(project: Project, accessoryCache: Accessories | null | undefined): string {
  const result = prepareStartJob(project, null, {
    statusReport: idleStatus,
    alarmCode: null,
    hasActiveStreamer: false,
    frameVerification: frameVerificationForProject(project),
    ...(accessoryCache === undefined ? {} : { accessoryCache }),
  });
  expect(result.ok).toBe(true);
  return result.ok ? result.warnings.join('\n') : '';
}

describe('CNC Start live accessory baseline', () => {
  it.each([
    [{ ...allOff, spindleCw: true }, 'clockwise spindle'],
    [{ ...allOff, spindleCcw: true }, 'counter-clockwise spindle'],
    [{ ...allOff, flood: true }, 'flood coolant'],
    [{ ...allOff, mist: true }, 'mist coolant'],
  ] as const)('warns on a controller-reported active %s', (accessories, label) => {
    const result = warningsOf(cncProject, accessories);
    expect(result).toContain(`GRBL currently reports active: ${label}`);
    expect(result).toContain('M5 and M9');
  });

  it('names every simultaneously active accessory', () => {
    const result = warningsOf(cncProject, {
      spindleCw: true,
      spindleCcw: false,
      flood: true,
      mist: true,
    });
    expect(result).toContain('clockwise spindle, flood coolant, mist coolant');
  });

  it('warns for grblHAL secondary-spindle telemetry', () => {
    expect(warningsOf(cncProject, { ...allOff, secondarySpindlePresent: true })).toContain(
      'secondary system spindle (SPn:)',
    );
  });

  it.each([
    [{ ...allOff, spindleEncoderFault: true }, 'spindle encoder fault (A:E)'],
    [{ ...allOff, toolChangePending: true }, 'tool change still pending (A:T)'],
  ] as const)('warns for grblHAL exceptional A flags', (accessories, message) => {
    expect(warningsOf(cncProject, accessories)).toContain(message);
  });

  it('does not add this warning for a known all-off observation', () => {
    expect(warningsOf(cncProject, allOff)).not.toMatch(/GRBL currently reports active/i);
  });

  it.each([null, undefined])(
    'warns for %s until A or Ov provides a fresh accessory-state observation',
    (accessories) => {
      expect(warningsOf(cncProject, accessories)).toContain(
        'CNC Start requires a fresh GRBL accessory-state observation',
      );
    },
  );

  it('does not apply the CNC-only accessory warnings to laser jobs', () => {
    const warnings = warningsOf(laserProject, { ...allOff, spindleCw: true, flood: true });
    expect(warnings).not.toMatch(/GRBL currently reports active/i);
    expect(warnings).not.toContain('fresh GRBL accessory-state observation');
  });
});
