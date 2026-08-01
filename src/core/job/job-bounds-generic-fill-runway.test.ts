import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { compileJob } from './compile-job';
import type { FillGroup, FillSegment, Job } from './job';
import { computeJobBounds, computeJobMotionBounds } from './job-bounds';

const DEFAULT_RUNWAY_MM = 5;

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

function job(segments: ReadonlyArray<FillSegment>): Job {
  const group: FillGroup = {
    kind: 'fill',
    layerId: 'trace-fill',
    color: '#000000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    fillStyle: 'scanline',
    fillRunwayPolicy: 'feed-matched-every-sweep',
    overscanMm: DEFAULT_RUNWAY_MM,
    segments,
  };
  return { groups: [group] };
}

function emittedJobMotionPoints(
  compiled: Job,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const lines = grblStrategy.emit(compiled, DEFAULT_DEVICE_PROFILE).split('\n');
  const stopIndex = lines.indexOf('M5');
  return lines.slice(0, stopIndex).flatMap((line) => {
    const x = /\bX(-?\d+(?:\.\d+)?)\b/.exec(line);
    const y = /\bY(-?\d+(?:\.\d+)?)\b/.exec(line);
    return x?.[1] === undefined || y?.[1] === undefined
      ? []
      : [{ x: Number(x[1]), y: Number(y[1]) }];
  });
}

describe('generic Scan Line Frame motion envelope', () => {
  it('keeps burn bounds unchanged while including a tiny sweep entry and exit', () => {
    const compiled = job([segment(10, 10.47)]);

    expect(computeJobBounds(compiled, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: 10,
      minY: 4,
      maxX: 10.47,
      maxY: 4,
    });
    expect(computeJobMotionBounds(compiled, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: 5,
      minY: 4,
      maxX: 15.47,
      maxY: 4,
    });
  });

  it('includes the exact outer runway extent for wide-gap split sweeps', () => {
    const compiled = job([segment(0, 1), segment(7, 8)]);
    const motionBounds = computeJobMotionBounds(compiled, DEFAULT_DEVICE_PROFILE);
    const emittedPoints = emittedJobMotionPoints(compiled);

    expect(computeJobBounds(compiled, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: 0,
      minY: 4,
      maxX: 8,
      maxY: 4,
    });
    expect(motionBounds).toEqual({
      minX: -5,
      minY: 4,
      maxX: 13,
      maxY: 4,
    });
    expect({
      minX: Math.min(...emittedPoints.map((point) => point.x)),
      minY: Math.min(...emittedPoints.map((point) => point.y)),
      maxX: Math.max(...emittedPoints.map((point) => point.x)),
      maxY: Math.max(...emittedPoints.map((point) => point.y)),
    }).toEqual(motionBounds);
  });

  it('matches emitted coordinates after reverse-row offset and controller rounding', () => {
    const group: FillGroup = {
      kind: 'fill',
      layerId: 'offset-trace-fill',
      color: '#000000',
      power: 30,
      speed: 1500,
      passes: 1,
      airAssist: false,
      fillStyle: 'scanline',
      fillRunwayPolicy: 'feed-matched-every-sweep',
      overscanMm: DEFAULT_RUNWAY_MM,
      bidirectionalScanOffsetMm: 0.0004,
      segments: [
        {
          polyline: [
            { x: 10.1234, y: 4.5674 },
            { x: 9.1114, y: 4.5674 },
          ],
          closed: false,
          reverse: true,
        },
      ],
    };
    const compiled: Job = { groups: [group] };
    const motionBounds = computeJobMotionBounds(compiled, DEFAULT_DEVICE_PROFILE);
    const emittedPoints = emittedJobMotionPoints(compiled);
    if (motionBounds === null) throw new Error('Expected generic Scan Line motion bounds');

    expect({
      minX: Math.min(...emittedPoints.map((point) => point.x)),
      minY: Math.min(...emittedPoints.map((point) => point.y)),
      maxX: Math.max(...emittedPoints.map((point) => point.x)),
      maxY: Math.max(...emittedPoints.map((point) => point.y)),
    }).toEqual({
      minX: Number(motionBounds.minX.toFixed(3)),
      minY: Number(motionBounds.minY.toFixed(3)),
      maxX: Number(motionBounds.maxX.toFixed(3)),
      maxY: Number(motionBounds.maxY.toFixed(3)),
    });
  });

  it('expands the Frame envelope of a compiled generic tiny triangle without changing burn bounds', () => {
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
    const burnBounds = computeJobBounds(compiled, DEFAULT_DEVICE_PROFILE);
    const motionBounds = computeJobMotionBounds(compiled, DEFAULT_DEVICE_PROFILE);

    expect(compiled.groups[0]).toMatchObject({
      kind: 'fill',
      fillRunwayPolicy: 'feed-matched-every-sweep',
    });
    expect(burnBounds).not.toBeNull();
    expect(motionBounds).not.toBeNull();
    expect(motionBounds?.minX).toBeCloseTo((burnBounds?.minX ?? 0) - DEFAULT_RUNWAY_MM, 6);
    expect(motionBounds?.maxX).toBeCloseTo((burnBounds?.maxX ?? 0) + DEFAULT_RUNWAY_MM, 6);
    expect(motionBounds?.minY).toBe(burnBounds?.minY);
    expect(motionBounds?.maxY).toBe(burnBounds?.maxY);
  });
});
