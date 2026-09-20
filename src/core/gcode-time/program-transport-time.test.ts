import { describe, expect, it } from 'vitest';
import { createStreamer } from '../controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration, type Job } from '../job';
import { grblStrategy } from '../output';
import { buildProgramTimeline } from './program-timeline';
import { deviceProgramTimingOptions } from './program-timing-options';
import { programTransportTime } from './program-transport-time';

const device = { ...DEFAULT_DEVICE_PROFILE, baudRate: 115200 };
const limits = {
  accelMmPerSec2: device.accelMmPerSec2,
  junctionDeviationMm: device.junctionDeviationMm,
  maxFeedMmPerMin: device.maxFeed,
};

describe('emitted serial timing', () => {
  it.each([
    ['spindle', 'M3 S100', 'M5'],
    ['fan', 'M106', 'M107'],
  ] as const)(
    'retains native %s power-off classification with separate calibration',
    (laserPowerControl, on, off) => {
      const result = buildProgramTimeline(
        `${on}\nG1 X100 F600\n${off}\nG1 X200`,
        { accelMmPerSec2: 1000, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 },
        { machineKind: 'laser', laserPowerControl, cutTimeScale: 2, travelTimeScale: 3 },
      );
      if (result.kind !== 'ok') throw new Error(result.reason);
      const clock = result.timeline;
      if (laserPowerControl === 'spindle') {
        // M5 drains the planner; each 100 mm move takes 10 + v/a seconds.
        expect(clock.breakdown.cutSeconds).toBeCloseTo(20.02, 7);
        expect(clock.breakdown.feedTravelSeconds).toBeCloseTo(30.03, 7);
      } else {
        // M106 defaults to full fan power when S is omitted, and M107 is
        // attached to the following motion without an added planner stop.
        expect(clock.breakdown.cutSeconds).toBeCloseTo(20.01, 7);
        expect(clock.breakdown.feedTravelSeconds).toBeCloseTo(30.015, 7);
      }
    },
  );

  it('cannot pre-transmit the next tool section during motion before M0', () => {
    const suffix = Array.from(
      { length: 2000 },
      (_, i) => `G1 X${(100 + (i + 1) / 1000).toFixed(3)} F6000`,
    ).join('\n');
    const prefix = 'G1 X100 F600';
    const combined = buildProgramTimeline(`${prefix}\nM0\n${suffix}`, limits, {
      baudRate: 115200,
      hostToolChangePauses: true,
    });
    const first = buildProgramTimeline(prefix, limits, { baudRate: 115200 });
    if (combined.kind !== 'ok' || first.kind !== 'ok') throw new Error('Expected timed sections');
    const secondDelivery =
      (Buffer.byteLength(createStreamer(suffix).queued.join('')) * 10) / 115200;
    expect(combined.timeline.totalSeconds).toBeGreaterThanOrEqual(
      first.timeline.totalSeconds + secondDelivery - 1e-8,
    );
    expect(combined.timeline.dwellSeconds).toBe(0);
  });
  it('counts the actual trimmed sender bytes and overlaps delivery with earlier execution', () => {
    const gcode = '; omitted\n  G1 X100 F600  \n\nG1 X200\n';
    const starts = new Float64Array([0, 0, 10, 10, 20]);
    const timing = programTransportTime(gcode, starts, 115200);
    const senderBytes = Buffer.byteLength(createStreamer(gcode).queued.join(''));
    expect(timing.wireSeconds).toBeCloseTo((senderBytes * 10) / 115200, 12);
    const firstArrival = ('G1 X100 F600\n'.length * 10) / 115200;
    expect(timing.rawLineTransportSeconds[4]).toBeCloseTo(firstArrival, 12);
    expect(timing.rawLineTransportSeconds[4]).toBeLessThan(timing.wireSeconds);
  });

  it('does not transmit host-managed tool changes or invent operator waiting time', () => {
    const gcode = 'G1 X10 F600\nM0 ; change bit\nG1 X20';
    const starts = new Float64Array([0, 1, 1]);
    const host = programTransportTime(gcode, starts, 100, true);
    const expectedBytes = 'G1 X10 F600\nG1 X20\n'.length;
    expect(host.wireSeconds).toBe((expectedBytes * 10) / 100);
    const timeline = buildProgramTimeline(gcode, limits, {
      baudRate: 100,
      hostToolChangePauses: true,
    });
    expect(timeline.kind).toBe('ok');
    if (timeline.kind !== 'ok') return;
    expect(timeline.timeline.pauseBarriers).toHaveLength(1);
    expect(timeline.timeline.dwellSeconds).toBe(0);
  });

  it('keeps a 20,000-segment vector above its actual serial floor in both clocks', () => {
    assertDeliveryFloor(
      {
        groups: [
          {
            kind: 'cut',
            layerId: 'dense',
            color: '#000',
            power: 50,
            speed: 6000,
            passes: 1,
            airAssist: false,
            segments: [
              {
                closed: false,
                polyline: Array.from({ length: 20_001 }, (_, index) => ({ x: index / 1000, y: 0 })),
              },
            ],
          },
        ],
      },
      30,
    );
  });

  it('keeps an alternating-power raster above its actual serial floor in both clocks', () => {
    assertDeliveryFloor(
      {
        groups: [
          {
            kind: 'raster',
            layerId: 'raster',
            color: '#000',
            power: 50,
            speed: 6000,
            passes: 1,
            airAssist: false,
            sValues: Uint16Array.from({ length: 5000 }, (_, i) => (i % 2 === 0 ? 100 : 500)),
            pixelWidth: 5000,
            pixelHeight: 1,
            bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0.1 },
            overscanMm: 0,
            dotWidthCorrectionMm: 0,
            bidirectional: false,
          },
        ],
      },
      6,
    );
  });

  it('counts fan-off G1 motion as travel with independent calibration', () => {
    const result = buildProgramTimeline('M106 S128\nG1 X100 F600\nM107\nG1 X200', limits, {
      machineKind: 'laser',
      fanPower: true,
      cutTimeScale: 2,
      travelTimeScale: 3,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.timeline.breakdown.cutSeconds).toBeGreaterThan(20);
    expect(result.timeline.breakdown.feedTravelSeconds).toBeGreaterThan(30);
    expect(result.timeline.breakdown.rapidTravelSeconds).toBe(0);
  });
});

function assertDeliveryFloor(job: Job, minimumWireSeconds: number): void {
  const gcode = grblStrategy.emit(job, device);
  const bytes = Buffer.byteLength(createStreamer(gcode).queued.join(''));
  const floor = (bytes * 10) / device.baudRate;
  const before = estimateJobDuration(job, device);
  const live = buildProgramTimeline(gcode, limits, {
    ...deviceProgramTimingOptions(device, 'laser'),
    initialPositionMm: { x: 0, y: 0, z: 0 },
  });
  expect(floor).toBeGreaterThan(minimumWireSeconds);
  expect(before.unavailableReason).toBeUndefined();
  expect(before.totalSeconds).toBeGreaterThanOrEqual(floor - 1e-8);
  expect(live.kind).toBe('ok');
  if (live.kind !== 'ok') return;
  expect(live.timeline.wireSeconds).toBeCloseTo(floor, 8);
  expect(live.timeline.totalSeconds).toBeCloseTo(before.totalSeconds, 8);
  expect(before.totalSeconds).toBeCloseTo(
    before.breakdown.cutSeconds +
      before.breakdown.travelSeconds +
      (before.breakdown.dwellSeconds ?? 0) +
      (before.breakdown.transportSeconds ?? 0),
    8,
  );
}
