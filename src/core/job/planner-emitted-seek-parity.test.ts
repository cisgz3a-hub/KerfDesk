import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { buildGcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from '../gcode-time/program-time';
import { grblStrategy } from '../output/grbl-strategy';
import { estimateJobDuration } from './estimate-duration';
import type { CutGroup, FillGroup, Job, RasterGroup } from './job';

const device: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 100,
  controlledLaserOffTravelFeedMmPerMin: 600,
  airAssistCommand: 'M8',
};

function line(start = 1, end = 2, extra: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'cut',
    color: '#000000',
    power: 50,
    speed: 600,
    passes: 1,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x: start, y: 0 },
          { x: end, y: 0 },
        ],
        closed: false,
      },
    ],
    ...extra,
  };
}

function compareProgram(job: Job, finishX: number, profile = device): number {
  const options = { finishPosition: { x: finishX, y: 0 } };
  const gcode = grblStrategy.emit(job, profile, options);
  const parsed = buildGcodeRenderModel(gcode);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const clock = buildProgramTime(parsed.model, {
    accelMmPerSec2: profile.accelMmPerSec2,
    junctionDeviationMm: profile.junctionDeviationMm,
    maxFeedMmPerMin: profile.maxFeed,
  });
  const estimate = estimateJobDuration(job, profile, options);
  expect(estimate.totalSeconds).toBeCloseTo(clock.totalSeconds, 6);
  return estimate.totalSeconds;
}

describe('controlled laser seeks preserve emitted motion and synchronization', () => {
  it('blends ten collinear controlled seeks and cuts at their actual G1 feed', () => {
    const group = line(1, 2, {
      segments: Array.from({ length: 10 }, (_, index) => ({
        polyline: [
          { x: index * 2 + 1, y: 0 },
          { x: index * 2 + 2, y: 0 },
        ],
        closed: false,
      })),
    });
    const job = { groups: [group] };
    expect(compareProgram(job, 20)).toBeCloseTo(2.1, 8);
    const estimate = estimateJobDuration(job, device, { finishPosition: { x: 20, y: 0 } });
    expect(estimate.breakdown.rapidTravelSeconds).toBe(0);
    expect(estimate.breakdown.feedTravelSeconds).toBeGreaterThan(0);
  });

  it('keeps the M5 drain before a collinear G1 parking move', () => {
    expect(compareProgram({ groups: [line()] }, 3)).toBeCloseTo(0.5, 8);
  });

  it.each([
    ['same mode and coolant', line(3, 4)],
    ['power mode change', line(3, 4, { powerMode: 'constant' })],
    ['coolant change', line(3, 4, { airAssist: true })],
  ] as const)('matches the actual %s group boundary', (_name, next) => {
    compareProgram({ groups: [line(), next] }, 4);
  });

  it('keeps redundant group arming continuous and actual mode changes stopped', () => {
    const continuous = compareProgram({ groups: [line(), line(3, 4)] }, 4);
    const stopped = compareProgram({ groups: [line(), line(3, 4, { powerMode: 'constant' })] }, 4);
    expect(stopped).toBeGreaterThan(continuous);
  });

  it.each([false, true])('matches vector pass re-arming with zero power=%s', (zeroPower) => {
    const group = line(1, 2, {
      power: zeroPower ? 0 : 50,
      passes: 2,
      segments: [
        {
          polyline: [
            { x: 1, y: 0 },
            { x: 2, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 0 },
          ],
          closed: true,
        },
      ],
    });
    compareProgram({ groups: [group] }, 1);
  });

  it.each([false, true])(
    'retains standalone re-arm semantics through empty groups with zero prior power=%s',
    (zeroPower) => {
      const empty = line(5, 6, { passes: 2, segments: [] });
      compareProgram({ groups: [line(1, 2, { power: zeroPower ? 0 : 50 }), empty, line(3, 4)] }, 4);
    },
  );

  it('omits collapsed vector seeks while retaining their emitted standalone pass re-arm', () => {
    const collapsed = line(4.0001, 4.0002, { passes: 2 });
    compareProgram({ groups: [line(), collapsed, line(3, 4)] }, 4);
  });

  it.each(['scanline', 'offset'] as const)('matches controlled %s Fill travel', (fillStyle) => {
    const base = line(2, 3);
    const fill: FillGroup = {
      ...base,
      kind: 'fill',
      fillStyle,
      overscanMm: 1,
      segments: base.segments.map((segment) => ({ ...segment, reverse: false })),
    };
    compareProgram({ groups: [fill] }, 5);
  });

  it('matches a feed-matched contour entry after its controlled seek', () => {
    compareProgram({ groups: [line(2, 3, { entryRunwayMm: 1 })] }, 3);
  });

  it('keeps raster shutdown and following vector re-arm as real boundaries', () => {
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'raster',
      color: '#000000',
      power: 50,
      speed: 600,
      passes: 1,
      airAssist: false,
      pixelWidth: 2,
      pixelHeight: 1,
      sValues: new Uint16Array([500, 500]),
      bounds: { minX: 1, maxX: 3, minY: -0.5, maxY: 0.5 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };
    compareProgram({ groups: [raster, line(4, 5)] }, 5);
  });

  it.each([0, 0.01])('calibrates represented S0 vector motion as travel at power %s', (power) => {
    const job = { groups: [line(1, 2, { power })] };
    compareProgram(job, 2);
    const baseline = estimateJobDuration(job, device, { finishPosition: { x: 2, y: 0 } });
    const calibrated = estimateJobDuration(
      job,
      { ...device, estimateCutTimeScale: 3, estimateTravelTimeScale: 2 },
      { finishPosition: { x: 2, y: 0 } },
    );
    expect(baseline.breakdown.cutSeconds).toBe(0);
    expect(calibrated.totalSeconds).toBeCloseTo(baseline.totalSeconds * 2, 8);
  });

  it('retains G0 motion for an ordinary profile without controlled seeks', () => {
    const { controlledLaserOffTravelFeedMmPerMin: unused, ...profile } = device;
    void unused;
    compareProgram({ groups: [line(), line(3, 4)] }, 5, profile);
    expect(
      estimateJobDuration({ groups: [line()] }, profile).breakdown.rapidTravelSeconds,
    ).toBeGreaterThan(0);
  });
});
