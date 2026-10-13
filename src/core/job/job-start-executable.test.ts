import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { createProject } from '../scene';
import { firstToolpathProcessPoint } from './first-process-point';
import type { CutGroup, CutSegment, FillGroup, Job } from './job';
import {
  applyJobStartPoint,
  jobStartEditingJob,
  jobStartPointOptions,
  resolveJobStartPoint,
} from './job-start-point';
import { buildMotionManifest } from './motion-manifest';

const line = (a: number, b: number): CutSegment => ({
  closed: false,
  polyline: [
    { x: a, y: 20 },
    { x: b, y: 20 },
  ],
});
const square = (a: number, size: number): CutSegment => ({
  closed: true,
  polyline: [
    { x: a, y: a },
    { x: a + size, y: a },
    { x: a + size, y: a + size },
    { x: a, y: a + size },
    { x: a, y: a },
  ],
});
const cut = (segments: ReadonlyArray<CutSegment>): CutGroup => ({
  kind: 'cut',
  layerId: 'cut',
  color: '#000',
  power: 50,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments,
});
const fill = (segment: CutSegment, overrides: Partial<FillGroup> = {}): FillGroup => ({
  ...cut([]),
  kind: 'fill',
  layerId: 'fill',
  overscanMm: 2,
  segments: [{ ...segment, reverse: false }],
  ...overrides,
});
const target = { x: 35, y: 20 };
const vector = cut([line(30, 40)]);
const emitted = (job: Job, device = DEFAULT_DEVICE_PROFILE) =>
  buildMotionManifest(grblStrategy.emit(job, device), { machineKind: 'laser' }).firstProcessPoint;

it.each(['open', 'closed'] as const)(
  'source order preserves the first %s contour and bypasses inside-first',
  (kind) => {
    const collapsed = line(10.0001, 10.0002);
    const first = kind === 'open' ? line(10, 20) : square(10, 20);
    const later = kind === 'open' ? line(30, 40) : square(15, 5);
    const input: Job = { groups: [cut([collapsed, first, later])] };
    const options = jobStartPointOptions({
      ...createProject().optimization,
      travelPolicy: 'source-order',
      insideFirst: true,
      pathDirection: 'allow-reverse',
    });
    const chosen = applyJobStartPoint(input, { x: 20, y: 15 }, options);
    const expected = kind === 'open' ? { x: 10, y: 20 } : { x: 20, y: 10 };
    expect(resolveJobStartPoint(input, { x: 20, y: 15 }, options)?.point).toEqual(expected);
    const group = chosen.groups[0];
    if (group?.kind !== 'cut') throw new Error('expected cut');
    expect(group.segments[0]).toBe(collapsed);
    expect(group.segments[2]).toBe(later);
    expect(group.segments[1]?.polyline[0]).toEqual(expected);
    expect(group.segments[1]?.polyline[1]).toEqual(
      kind === 'open' ? { x: 20, y: 20 } : { x: 30, y: 10 },
    );
    expect(emitted(chosen)).toEqual({ ...expected, z: 0 });
  },
);

describe('fill executable start selection', () => {
  it.each([
    fill(line(10, 10)),
    fill(line(10.0001, 10.0002)),
    fill(square(10.0001, 0.0001), { fillStyle: 'offset' }),
    fill(line(10.0001, 10.0002), { fillRunwayPolicy: 'feed-matched-every-sweep' }),
  ])('skips a fill with no emitted powered XY motion', (empty) => {
    const input: Job = { groups: [empty, vector] };
    const selected = applyJobStartPoint(input, target);
    expect(resolveJobStartPoint(input, target)).toEqual({
      point: { x: 30, y: 20 },
      supported: true,
    });
    expect(jobStartEditingJob(input)).toEqual({ groups: [vector] });
    expect(firstToolpathProcessPoint(selected)).toEqual({ x: 30, y: 20 });
    expect(emitted(selected)).toEqual({ x: 30, y: 20, z: 0 });
  });

  it('skips collapsed ink within a sweep but retains the first later moving fill span', () => {
    const group = fill(line(10.0001, 10.0002), {
      segments: [
        { ...line(10.0001, 10.0002), reverse: false },
        { ...line(12, 13), reverse: false },
      ],
    });
    const input: Job = { groups: [group, vector] };
    expect(resolveJobStartPoint(input, target)).toMatchObject({
      point: { x: 12, y: 20 },
      supported: false,
    });
    expect(firstToolpathProcessPoint(input)).toEqual({ x: 12, y: 20 });
    expect(emitted(input)).toEqual({ x: 12, y: 20, z: 0 });
  });

  it('uses calibrated reverse offsets and caches each effective offset separately', () => {
    const group = fill(line(10.0002, 10.0001), {
      segments: [{ ...line(10.0002, 10.0001), reverse: true }],
      fillRunwayPolicy: 'feed-matched-every-sweep',
    });
    const input: Job = { groups: [group, vector] };
    const scanningOffsets = [{ speedMmPerMin: 1000, offsetMm: 0.00065 }];
    const options = jobStartPointOptions(createProject().optimization, scanningOffsets);
    expect(jobStartEditingJob(input)).toEqual({ groups: [vector] });
    expect(resolveJobStartPoint(input, target)?.supported).toBe(true);
    expect(jobStartEditingJob(input, options)).toEqual({ groups: [] });
    expect(resolveJobStartPoint(input, target, options)?.supported).toBe(false);
    expect(applyJobStartPoint(input, target, options)).toBe(input);
    const point = firstToolpathProcessPoint(input, options);
    expect(point?.x).toBeCloseTo(9.99955, 8);
    expect(emitted(input, { ...DEFAULT_DEVICE_PROFILE, scanningOffsets })).toEqual({
      x: 10,
      y: 20,
      z: 0,
    });
    expect(resolveJobStartPoint(input, target)?.supported).toBe(true);
    expect(jobStartEditingJob(input)).toEqual({ groups: [vector] });
  });
});
