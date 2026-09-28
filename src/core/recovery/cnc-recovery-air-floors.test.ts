import { describe, expect, it } from 'vitest';
import { createStreamer } from '../controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass, Job } from '../job';
import { cncGrblStrategy } from '../output';
import { buildCncPassResumeJob } from './cnc-pass-resume-job';
import { planCncPauseReentry } from './cnc-pause-reentry';

// ADR-489: passes entered by a rapid down to their air floor, seen from the
// two ways a CNC job restarts.

const ring = (zMm: number, airFloorZMm?: number): CncPass => ({
  kind: 'contour',
  zMm,
  polyline: [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
  ],
  closed: false,
  ...(airFloorZMm === undefined ? {} : { airFloorZMm }),
});

const group: CncGroup = {
  kind: 'cnc',
  layerId: 'L1',
  color: '#a0522d',
  cutType: 'relief-rough',
  toolDiameterMm: 3.175,
  feedMmPerMin: 1000,
  plungeMmPerMin: 300,
  spindleRpm: 18000,
  spindleSpinupSec: 2,
  safeZMm: 5,
  passes: [ring(-1.5), ring(-3, -1.5), ring(-4.5, -3)],
};
const job: Job = { groups: [group] };

describe('recovery and air floors (ADR-489)', () => {
  it('plunges every pass of a pass-boundary recovery job from safe Z', () => {
    const resume = buildCncPassResumeJob(job, 0, 2);
    if (resume.kind !== 'resume-job') throw new Error(resume.reason);
    const passes = resume.job.groups.flatMap((next) => (next.kind === 'cnc' ? next.passes : []));
    expect(passes).toEqual([ring(-4.5)]);
    const gcode = cncGrblStrategy.emit(resume.job, DEFAULT_DEVICE_PROFILE);
    expect(gcode).toContain('G0 X10.000 Y10.000\nG1 Z-4.500 F300\n');
  });

  it('lifts and re-enters a pass that was entered through its air', () => {
    const lines = createStreamer(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).queued;
    const airDescent = lines.indexOf('G0 Z-0.500\n');
    expect(lines[airDescent + 1]).toBe('G1 Z-3.000 F300\n');
    const cut = airDescent + 2;
    const stopped = planCncPauseReentry({
      lines,
      ackedLines: cut + 1,
      stopPoint: { x: 20, y: 10, z: -3 },
      controllerKind: 'grbl-v1.1',
    });
    if (stopped.kind !== 'plan') throw new Error(stopped.reason);
    // The lift keeps the program's real safe height, not the air descent's.
    expect(stopped.plan.safeZMm).toBe(5);
    expect(stopped.plan.plungeFeedMmPerMin).toBe(300);
    expect(stopped.plan.resumeLineIndex).toBe(cut);

    // Stopped part way down the rapid, the bit is in air above the pass. The
    // first pass's plunge at the same XY is the earliest line through it, so
    // the replay starts there and only recuts.
    const midAir = planCncPauseReentry({
      lines,
      ackedLines: airDescent + 1,
      stopPoint: { x: 10, y: 10, z: 1 },
      controllerKind: 'grbl-v1.1',
    });
    if (midAir.kind !== 'plan') throw new Error(midAir.reason);
    expect(midAir.plan.resumeLineIndex).toBe(lines.indexOf('G1 Z-1.500 F300\n'));
    expect(midAir.plan.entry).toEqual({ x: 10, y: 10, z: 1 });
  });
});
