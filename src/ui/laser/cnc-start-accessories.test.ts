import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
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
const cncProject: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const laserProject = createProject();

function messages(project: Project, accessoryCache: Accessories | null | undefined): string {
  const result = prepareStartJob(project, null, {
    statusReport: idleStatus,
    alarmCode: null,
    hasActiveStreamer: true,
    ...(accessoryCache === undefined ? {} : { accessoryCache }),
  });
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.messages.join('\n');
}

describe('CNC Start live accessory baseline', () => {
  it.each([
    [{ ...allOff, spindleCw: true }, 'clockwise spindle'],
    [{ ...allOff, spindleCcw: true }, 'counter-clockwise spindle'],
    [{ ...allOff, flood: true }, 'flood coolant'],
    [{ ...allOff, mist: true }, 'mist coolant'],
  ] as const)('blocks a controller-reported active %s', (accessories, label) => {
    const result = messages(cncProject, accessories);
    expect(result).toContain(`GRBL currently reports active: ${label}`);
    expect(result).toContain('M5 and M9');
  });

  it('names every simultaneously active accessory', () => {
    const result = messages(cncProject, {
      spindleCw: true,
      spindleCcw: false,
      flood: true,
      mist: true,
    });
    expect(result).toContain('clockwise spindle, flood coolant, mist coolant');
  });

  it('fails closed for grblHAL secondary-spindle telemetry', () => {
    expect(messages(cncProject, { ...allOff, secondarySpindlePresent: true })).toContain(
      'secondary system spindle (SPn:)',
    );
  });

  it.each([
    [{ ...allOff, spindleEncoderFault: true }, 'spindle encoder fault (A:E)'],
    [{ ...allOff, toolChangePending: true }, 'tool change still pending (A:T)'],
  ] as const)('fails closed for grblHAL exceptional A flags', (accessories, message) => {
    expect(messages(cncProject, accessories)).toContain(message);
  });

  it('does not add this blocker for a known all-off observation', () => {
    expect(messages(cncProject, allOff)).not.toMatch(/GRBL currently reports active/i);
  });

  it.each([null, undefined])(
    'fails closed for %s until A or Ov provides a fresh accessory-state observation',
    (accessories) => {
      expect(messages(cncProject, accessories)).toContain(
        'CNC Start requires a fresh GRBL accessory-state observation',
      );
    },
  );

  it('does not apply the CNC-only gate to laser jobs', () => {
    expect(messages(laserProject, { ...allOff, spindleCw: true, flood: true })).not.toMatch(
      /GRBL currently reports active/i,
    );
  });
});
