import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { MotionLimits } from './motion-limits';
import { buildProgramDuration } from './program-duration';
import { buildProgramTimeline, type ProgramTimelineOptions } from './program-timeline';
import { forEachRawLine } from './program-transport-time';
import { deviceMotionLimits, deviceProgramTimingOptions } from './program-timing-options';

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};
const COREXY: MotionLimits = { ...LIMITS, kinematics: 'corexy' };

// Deterministic programs that exercise every total: cuts, rapids, laser-off
// feeds, arcs, Z, dwells before and after motion, M0/M1 pauses (also inside
// comments), blank and comment lines, and all three line endings.
function program(seed: number, lines: number): string {
  let state = seed;
  const next = (): number => {
    state = (state * 1_103_515_245 + 12_345) >>> 0;
    return state / 2 ** 32;
  };
  const out = ['G21 G90', 'M4 S0'];
  let px = 0;
  for (let i = 0; i < lines; i += 1) {
    const r = next();
    const nx = next() * 180;
    const x = nx.toFixed(3);
    const y = (next() * 200).toFixed(3);
    if (r < 0.35) {
      out.push(`G1 X${x} Y${y} S${Math.round(next() * 1000)} F${600 + Math.round(next() * 3000)}`);
      px = Number(x);
    } else if (r < 0.5) {
      out.push(`G0 X${x} Y${y}`);
      px = Number(x);
    } else if (r < 0.6) {
      out.push(`G1 X${x} S0 F1200`);
      px = Number(x);
    } else if (r < 0.66) {
      // A half circle from the current point: always a valid arc. G1 then
      // restores the motion mode the bare X/Y lines continue.
      out.push(`G2 X${(px + 10).toFixed(3)} I5 J0 F900 S300`, 'G1');
      px += 10;
    } else if (r < 0.7) out.push(`G4 P${(next() * 2).toFixed(2)}`);
    else if (r < 0.72) out.push(next() < 0.5 ? 'M0' : 'M1 (optional stop)');
    else if (r < 0.74) out.push('(M0 inside a comment)');
    else if (r < 0.76) out.push('');
    else if (r < 0.78) out.push(`G1 Z${(next() * -2).toFixed(2)} F300`);
    else {
      out.push(`X${x} Y${y}`);
      px = Number(x);
    }
  }
  out.push('M5', 'M2');
  const endings = ['\n', '\r\n', '\r'];
  return out.reduce(
    (text, line, index) => text + (index === 0 ? '' : endings[(seed + index) % 3]) + line,
    '',
  );
}

function expectSameTotals(
  gcode: string,
  options: ProgramTimelineOptions,
  limits: MotionLimits = LIMITS,
): void {
  const timeline = buildProgramTimeline(gcode, limits, options);
  const duration = buildProgramDuration(gcode, limits, options);
  expect(timeline.kind === 'ok' ? 'ok' : timeline.reason).toBe('ok');
  if (timeline.kind !== 'ok' || duration.kind !== 'ok') {
    expect(duration).toEqual(timeline);
    return;
  }
  const t = timeline.timeline;
  // Object.is: the very same doubles, not merely close ones.
  expect(duration.duration).toEqual({
    totalSeconds: t.totalSeconds,
    motionSeconds: t.motionSeconds,
    dwellSeconds: t.dwellSeconds,
    transportSeconds: t.transportSeconds,
    breakdown: t.breakdown,
    pauseCount: t.pauseBarriers.length,
  });
  const d = duration.duration;
  const same: ReadonlyArray<[string, number, number]> = [
    ['total', d.totalSeconds, t.totalSeconds],
    ['motion', d.motionSeconds, t.motionSeconds],
    ['dwell', d.dwellSeconds, t.dwellSeconds],
    ['transport', d.transportSeconds, t.transportSeconds],
    ['cut', d.breakdown.cutSeconds, t.breakdown.cutSeconds],
    ['rapid', d.breakdown.rapidTravelSeconds, t.breakdown.rapidTravelSeconds],
    ['feed travel', d.breakdown.feedTravelSeconds, t.breakdown.feedTravelSeconds],
  ];
  for (const [name, actual, expected] of same) expect(Object.is(actual, expected), name).toBe(true);
}

const LASER_100: ProgramTimelineOptions = {
  baudRate: 115_200,
  plannerBlocks: 100,
  machineKind: 'laser',
  cutTimeScale: 1.07,
  travelTimeScale: 0.93,
};

describe('buildProgramDuration', () => {
  const variants: ReadonlyArray<[string, ProgramTimelineOptions, MotionLimits?]> = [
    ['no serial link', {}],
    ['115200 baud', { baudRate: 115_200 }],
    ['9600 baud, transport-bound', { baudRate: 9_600 }],
    ['host tool-change pauses', { baudRate: 115_200, hostToolChangePauses: true }],
    ['a 16-block planner window', { baudRate: 115_200, plannerBlocks: 16 }],
    ['a one-block planner window', { plannerBlocks: 1 }],
    ['a two-block planner window', { plannerBlocks: 2 }],
    ['a 100-block planner window', { plannerBlocks: 100 }],
    ['a calibrated laser', { machineKind: 'laser', cutTimeScale: 1.07, travelTimeScale: 0.93 }],
    ['CoreXY kinematics', {}, COREXY],
    ['CoreXY and a 15-block planner window', { baudRate: 115_200, plannerBlocks: 15 }, COREXY],
    ['CoreXY, a 100-block window and a calibrated laser', LASER_100, COREXY],
  ];
  for (const [name, options, limits] of variants) {
    it(`gives the timeline's exact totals with ${name}`, () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) expectSameTotals(program(seed, 400), options, limits);
    });
  }

  it("gives the timeline's exact totals across dwells, pauses and program ends", () => {
    // Every G4, M0, M1 and M2/M30 drains the planner, so this program is
    // timed in many separately planned spans, including motion after M2.
    const gcode = [
      'G21 G90 M4 S0',
      'G1 X10 Y0 S500 F3000',
      'G1 X20 Y5',
      'G4 P0.25',
      'G1 X30 Y5',
      'G1 X40 Y20',
      'M0',
      'G0 X0 Y0',
      'G1 X5 Y5 S200 F1200',
      'G4 P0 G1 X6 Y5',
      'G1 X7 Y6',
      'M1',
      'G1 X12 Y9',
      'M2',
      'G0 X50 Y50',
      'G1 X60 Y50 S300 F2400',
      'M30',
    ].join('\n');
    for (const plannerBlocks of [undefined, 1, 2, 15]) {
      const options = plannerBlocks === undefined ? {} : { plannerBlocks };
      expectSameTotals(gcode, options);
      expectSameTotals(gcode, { ...options, baudRate: 115_200 }, COREXY);
    }
  });

  it("gives the timeline's exact totals for a device's real timing options", () => {
    const device = DEFAULT_DEVICE_PROFILE;
    const options = deviceProgramTimingOptions(device, 'laser');
    const gcode = program(9, 2_000);
    const timeline = buildProgramTimeline(gcode, deviceMotionLimits(device), options);
    const duration = buildProgramDuration(gcode, deviceMotionLimits(device), options);
    expect(timeline.kind === 'ok' ? 'ok' : timeline.reason).toBe('ok');
    expect(duration.kind).toBe('ok');
    if (timeline.kind === 'ok' && duration.kind === 'ok') {
      expect(duration.duration.totalSeconds).toBe(timeline.timeline.totalSeconds);
      expect(duration.duration.transportSeconds).toBe(timeline.timeline.transportSeconds);
    }
  });

  it("gives the timeline's exact totals for a CoreXY grblHAL machine's options", () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grblhal' as const,
      kinematics: 'corexy' as const,
    };
    const options = deviceProgramTimingOptions(device, 'laser');
    const limits = deviceMotionLimits(device);
    expect(options.plannerBlocks).toBe(100);
    expect(limits.kinematics).toBe('corexy');
    for (const seed of [12, 13]) expectSameTotals(program(seed, 2_000), options, limits);
  });

  it('reports the same reason when timing is unavailable', () => {
    const cases: ReadonlyArray<[string, ProgramTimelineOptions]> = [
      ['G21 G90\nG28\nG1 X10 F600', {}],
      // The streamed parse keeps no moves, so it finds the missing feed itself.
      ['G21 G90\nG0 X5\nG1 X10\nG1 X20 F600', {}],
      ['G21 G90\nG1 X10 F600\nG1 X20 F0\nG1 X30 F600', {}],
      ['G21 G90\nG1 X10 F600\nG4 P1\nG1 X20 Y5\nG1 X30', { maxSegments: 2 }],
      ['', {}],
      ['not g-code at all', {}],
    ];
    for (const [gcode, options] of cases) {
      const timeline = buildProgramTimeline(gcode, LIMITS, options);
      expect(timeline.kind).not.toBe('ok');
      expect(buildProgramDuration(gcode, LIMITS, options)).toEqual(timeline);
    }
  });
});

describe('forEachRawLine', () => {
  it('visits exactly the lines split(/\\r\\n|\\n|\\r/) gives', () => {
    const samples = [
      '',
      'G1',
      'a\nb',
      'a\r\nb\r\n',
      'a\rb\r',
      '\n\n',
      '\r\r\n\n\r',
      'x\r\n\r\ny',
      program(11, 50),
    ];
    for (const sample of samples) {
      const lines: string[] = [];
      forEachRawLine(sample, (line, index) => {
        expect(index).toBe(lines.length);
        lines.push(line);
      });
      expect(lines).toEqual(sample.split(/\r\n|\n|\r/));
    }
  });
});
