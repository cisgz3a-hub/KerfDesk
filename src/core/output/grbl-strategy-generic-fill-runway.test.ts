import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob, type FillGroup, type FillSegment, type Job } from '../job';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { grblStrategy } from './grbl-strategy';

const BURN_FEED_MM_PER_MIN = 1500;
const DEFAULT_RUNWAY_MM = 5;
const LASER_POWER_PERCENT = 30;
const LASER_POWER_S = 300;

function segment(x0: number, x1: number): FillSegment {
  return {
    polyline: [
      { x: x0, y: 4 },
      { x: x1, y: 4 },
    ],
    closed: false,
    reverse: false,
  };
}

function fillGroup(
  segments: ReadonlyArray<FillSegment>,
  overscanMm = DEFAULT_RUNWAY_MM,
): FillGroup {
  return {
    kind: 'fill',
    layerId: 'trace-fill',
    color: '#000000',
    power: LASER_POWER_PERCENT,
    speed: BURN_FEED_MM_PER_MIN,
    passes: 1,
    airAssist: false,
    fillStyle: 'scanline',
    fillRunwayPolicy: 'feed-matched-every-sweep',
    overscanMm,
    segments,
  };
}

function emit(job: Job): string {
  return grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
}

function motionLines(job: Job): ReadonlyArray<string> {
  return emit(job)
    .split('\n')
    .filter((line) => /^G[01]\b/.test(line));
}

function fillMotionLines(group: FillGroup): ReadonlyArray<string> {
  return motionLines({ groups: [group] });
}

function assertEveryPoweredStartFollowsFeedMatchedLaserOffMotion(
  lines: ReadonlyArray<string>,
): void {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || !new RegExp(`\\bS${LASER_POWER_S}\\b`).test(line)) continue;
    expect(lines[index - 1]).toMatch(/^G1\b.*\bS0\b/);
  }
}

describe('generic Scan Line feed-matched runway emission', () => {
  it('surrounds a sub-millimetre triangle-tip sweep with laser-off feed motion', () => {
    const lines = fillMotionLines(fillGroup([segment(10, 10.47)]));

    expect(lines.slice(0, 4)).toEqual([
      'G0 X5.000 Y4.000 S0',
      'G1 X10.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X10.470 Y4.000 F1500 S300',
      'G1 X15.470 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
    ]);
    assertEveryPoweredStartFollowsFeedMatchedLaserOffMotion(lines);
  });

  it('preserves close-gap S0 bridging across a hole inside one sweep', () => {
    const lines = fillMotionLines(fillGroup([segment(10, 12), segment(12.5, 14)]));

    expect(lines.slice(0, 6)).toEqual([
      'G0 X5.000 Y4.000 S0',
      'G1 X10.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X12.000 Y4.000 F1500 S300',
      'G1 X12.500 Y4.000 S0',
      'G1 X14.000 Y4.000 S300',
      'G1 X19.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
    ]);
    expect(lines.filter((line) => line.startsWith('G0 '))).toHaveLength(2);
  });

  it('gives both sides of a wide-gap split bounded feed-matched runway motion', () => {
    const lines = fillMotionLines(fillGroup([segment(0, 1), segment(7, 8)]));

    expect(lines.slice(0, 8)).toEqual([
      'G0 X-5.000 Y4.000 S0',
      'G1 X0.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X1.000 Y4.000 F1500 S300',
      'G1 X4.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G0 X4.000 Y4.000 S0',
      'G1 X7.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X8.000 Y4.000 F1500 S300',
      'G1 X13.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
    ]);
    assertEveryPoweredStartFollowsFeedMatchedLaserOffMotion(lines);
  });

  it('keeps full runways on both split sides when the blank gap has a center remainder', () => {
    const lines = fillMotionLines(fillGroup([segment(0, 1), segment(13, 14)]));

    expect(lines.slice(2, 7)).toEqual([
      'G1 X1.000 Y4.000 F1500 S300',
      'G1 X6.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G0 X8.000 Y4.000 S0',
      'G1 X13.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X14.000 Y4.000 F1500 S300',
    ]);
  });

  it('changes only laser-off travel geometry between positive runway lengths', () => {
    const segments = [segment(0, 1), segment(7, 8)];
    const poweredTargets = (overscanMm: number): ReadonlyArray<string> =>
      fillMotionLines(fillGroup(segments, overscanMm)).filter((line) =>
        new RegExp(`\\bS${LASER_POWER_S}\\b`).test(line),
      );

    expect(poweredTargets(DEFAULT_RUNWAY_MM)).toEqual(poweredTargets(2));
  });

  it('uses the bounded generic default when a persisted overscan value is zero', () => {
    const group = fillGroup([segment(10, 10.47)], 0);
    const lines = fillMotionLines(group);
    const gcode = emit({ groups: [group] });

    expect(lines.slice(0, 4)).toEqual([
      'G0 X5.000 Y4.000 S0',
      'G1 X10.000 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X10.470 Y4.000 F1500 S300',
      'G1 X15.470 Y4.000 F1500 S0 ; kerfdesk:laser-off-motion',
    ]);
    expect(gcode).toContain('overscan 0.000 mm; generic minimum 5.000 mm applied');
    assertEveryPoweredStartFollowsFeedMatchedLaserOffMotion(lines);
  });

  it('records truthful universal runway provenance in the emitted header', () => {
    const gcode = emit({ groups: [fillGroup([segment(10, 10.47)])] });

    expect(gcode).toContain('feed-matched entry and exit up to 5.000 mm on every Scan Line sweep');
    expect(gcode).not.toContain('skipped on runs shorter');
    expect(gcode).not.toContain('4040 entry runway');
  });

  it('applies the same entry contract to a compiled tiny triangle tip', () => {
    const color = '#000000';
    const triangle: SceneObject = {
      kind: 'imported-svg',
      id: 'tiny-triangle',
      source: 'tiny-triangle.svg',
      bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color,
          polylines: [
            {
              closed: true,
              points: [
                { x: 10, y: 11 },
                { x: 10.5, y: 10 },
                { x: 11, y: 11 },
              ],
            },
          ],
        },
      ],
    };
    const layer = {
      ...createLayer({ id: 'trace-fill', color, mode: 'fill' }),
      hatchSpacingMm: 0.25,
    };
    const compiled = compileJob({ objects: [triangle], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
    const lines = motionLines(compiled);

    expect(compiled.groups[0]).toMatchObject({
      kind: 'fill',
      fillRunwayPolicy: 'feed-matched-every-sweep',
    });
    assertEveryPoweredStartFollowsFeedMatchedLaserOffMotion(lines);
  });
});
