import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { createProject } from '../../../core/scene';
import { rotaryAxisStartWarnings } from '../rotary-axis-start-warnings';
import { detectRotarySurfaceSpeedWarnings } from './rotary-surface-speed-warnings';

// ADR-695 Amendment 1: rolling audit v13 Y5-P1-4 (a Z or A axis's own max
// rate), Y5-P3-1 (wording on A, round strokes only) and Y5-P1-1 (the turn
// since an Abort, said in Job Review).

const CHUCK_A: RotarySetup = {
  enabled: true,
  type: 'chuck',
  axis: 'A',
  axisConfirmed: 'A',
  mmPerRotation: 360,
  objectDiameterMm: 80,
};

function job(speed: number, roundTheParts: boolean): Job {
  const polyline = roundTheParts
    ? [
        { x: 0, y: 0 },
        { x: 0, y: 20 },
      ]
    : [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ];
  return { groups: [{ kind: 'fill', speed, segments: [{ polyline }] }] } as unknown as Job;
}

function project(rotary: RotarySetup, controllerKind: 'grblhal' | 'grbl-v1.1' = 'grblhal') {
  return createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind, rotary, maxFeed: 36000 });
}

describe('the rotary axis max rate in Job Review', () => {
  it('warns when strokes round the part need more A than $113 allows', () => {
    // 360° per π·80 mm: 1.43° per surface mm; 3000 mm/min needs 4297°/min.
    const warnings = detectRotarySurfaceSpeedWarnings(project(CHUCK_A), job(3000, true), {
      maxRateA: 2000,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('A 1.43° per mm of surface');
    expect(warnings[0]).toContain('4298 °/min of A');
    expect(warnings[0]).toContain('$113=2000');
    expect(warnings[0]).toContain('1396 mm/min or less');
  });

  it('warns on a Z rotary against $112', () => {
    const onZ = project({ ...CHUCK_A, axis: 'Z', mmPerRotation: 40 }, 'grbl-v1.1');
    const warnings = detectRotarySurfaceSpeedWarnings(onZ, job(6000, true), { maxRateZ: 500 });
    expect(warnings[0]).toContain('$112=500');
  });

  it('stays silent for a fill along X, and without a reported rate', () => {
    expect(
      detectRotarySurfaceSpeedWarnings(project(CHUCK_A), job(3000, false), { maxRateA: 2000 }),
    ).toEqual([]);
    expect(detectRotarySurfaceSpeedWarnings(project(CHUCK_A), job(3000, true), null)).toEqual([]);
  });

  it('keeps the Y-port Max feed wording', () => {
    const roller: RotarySetup = {
      enabled: true,
      type: 'roller',
      mmPerRotation: 150,
      rollerDiameterMm: 26,
      objectDiameterMm: 80,
    };
    const yProject = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: roller, maxFeed: 6000 });
    const [warning] = detectRotarySurfaceSpeedWarnings(yProject, job(4000, true));
    expect(warning).toMatch(/^This rotary turns Y ×1\.84, so a 4000 mm\/min stroke round the part/);
  });
});

describe('the turn since an Abort on a dedicated axis', () => {
  it('says how far the part turned and how to turn it back', () => {
    const [warning] = rotaryAxisStartWarnings(project(CHUCK_A), {
      rotaryTurnSinceAbort: { axis: 'A', since: 160.4 },
    });
    expect(warning).toContain('the part has turned +160.4°');
    expect(warning).toContain('turn the part −160.4°');
  });

  it('is silent once the part is back at the turn the job started from', () => {
    expect(
      rotaryAxisStartWarnings(project(CHUCK_A), {
        rotaryTurnSinceAbort: { axis: 'A', since: 0.1 },
      }),
    ).toEqual([]);
  });
});
