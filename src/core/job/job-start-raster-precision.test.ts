import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import type { CutGroup, Group, RasterGroup } from './job';
import { firstToolpathProcessPoint } from './first-process-point';
import { computeJobStartBounds } from './job-start-bounds';
import { applyJobStartPoint, jobStartEditingJob, resolveJobStartPoint } from './job-start-point';
import { buildMotionManifest } from './motion-manifest';

const vector: CutGroup = {
  kind: 'cut',
  layerId: 'vector',
  color: '#000000',
  power: 50,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments: [
    {
      closed: false,
      polyline: [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
      ],
    },
  ],
};

function raster(overrides: Partial<RasterGroup> = {}): RasterGroup {
  return {
    ...vector,
    kind: 'raster',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0.0001, maxX: 0.0002, minY: 0, maxY: 1 },
    sValues: new Uint16Array([500]),
    overscanMm: 3,
    dotWidthCorrectionMm: 0,
    ...overrides,
  };
}

function emitted(groups: ReadonlyArray<Group>) {
  const point = buildMotionManifest(grblStrategy.emit({ groups }, DEFAULT_DEVICE_PROFILE), {
    machineKind: 'laser',
  }).firstProcessPoint;
  return point === null ? null : { x: point.x, y: point.y };
}

describe('cutting starts at represented raster precision', () => {
  it.each([0, 45, 90])(
    'skips a collapsed raster at scan angle %s before a real vector',
    (angle) => {
      const group = raster({ scanAngleDeg: angle });
      const job = { groups: [group, vector] };
      expect(emitted([group])).toBeNull();
      expect(firstToolpathProcessPoint(job)).toEqual(emitted(job.groups));
      const target = { x: 30, y: 20 };
      expect(resolveJobStartPoint(job, target)).toEqual({ point: target, supported: true });
      expect(jobStartEditingJob(job)).toEqual({ groups: [vector] });
      const selected = applyJobStartPoint(job, target);
      expect(emitted(selected.groups)).toEqual(target);
      expect(computeJobStartBounds(job, DEFAULT_DEVICE_PROFILE)).toEqual({
        minX: 20,
        maxX: 30,
        minY: 20,
        maxY: 20,
      });
    },
  );

  it('retains a later run in the same raster from the represented head after a collapsed run', () => {
    const group = raster({
      pixelWidth: 2,
      bounds: { minX: 0.0001, maxX: 0.0007, minY: 0, maxY: 1 },
      sValues: new Uint16Array([200, 500]),
    });
    const job = { groups: [group, vector] };
    expect(firstToolpathProcessPoint(job)).toEqual(emitted(job.groups));
    expect(firstToolpathProcessPoint(job)).toEqual({ x: 0, y: 0.5 });
    expect(resolveJobStartPoint(job, { x: 30, y: 20 })?.supported).toBe(false);
    expect(computeJobStartBounds({ groups: [group] }, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: 0,
      maxX: 0.001,
      minY: 0.5,
      maxY: 0.5,
    });
  });

  it('checks both machine axes after rotation and keeps calibrated reverse rows', () => {
    const group = raster({
      pixelHeight: 2,
      bounds: { minX: 0.0001, maxX: 0.0002, minY: -0.25, maxY: 0.75 },
      sValues: new Uint16Array([500, 500]),
      bidirectionalScanOffsetMm: 0.00065,
    });
    const job = { groups: [group] };
    expect(firstToolpathProcessPoint(job)).toEqual(emitted(job.groups));
    expect(firstToolpathProcessPoint(job)).toEqual({ x: 0, y: 0.5 });
    expect(computeJobStartBounds(job, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: -0.001,
      maxX: 0,
      minY: 0.5,
      maxY: 0.5,
    });

    const angled = raster({
      scanAngleDeg: 45,
      bounds: { minX: 0, maxX: 0.0006, minY: -0.5, maxY: 0.5 },
    });
    expect(emitted([angled])).toBeNull();
    expect(firstToolpathProcessPoint({ groups: [angled] })).toBeNull();
    expect(computeJobStartBounds({ groups: [angled] }, DEFAULT_DEVICE_PROFILE)).toBeNull();
  });
});
