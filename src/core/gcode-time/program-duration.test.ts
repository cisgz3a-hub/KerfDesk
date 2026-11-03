import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { buildProgramDuration } from './program-duration';
import { buildProgramTimeline, type ProgramTimelineOptions } from './program-timeline';
import { forEachRawLine } from './program-transport-time';
import { deviceMotionLimits, deviceProgramTimingOptions } from './program-timing-options';

const LIMITS = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };

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

function expectSameTotals(gcode: string, options: ProgramTimelineOptions): void {
  const timeline = buildProgramTimeline(gcode, LIMITS, options);
  const duration = buildProgramDuration(gcode, LIMITS, options);
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
  expect(Object.is(duration.duration.totalSeconds, t.totalSeconds)).toBe(true);
}

describe('buildProgramDuration', () => {
  const variants: ReadonlyArray<[string, ProgramTimelineOptions]> = [
    ['no serial link', {}],
    ['115200 baud', { baudRate: 115_200 }],
    ['9600 baud, transport-bound', { baudRate: 9_600 }],
    ['host tool-change pauses', { baudRate: 115_200, hostToolChangePauses: true }],
    ['a 16-block planner window', { baudRate: 115_200, plannerBlocks: 16 }],
    ['a calibrated laser', { machineKind: 'laser', cutTimeScale: 1.07, travelTimeScale: 0.93 }],
  ];
  for (const [name, options] of variants) {
    it(`gives the timeline's exact totals with ${name}`, () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) expectSameTotals(program(seed, 400), options);
    });
  }

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

  it('reports the same reason when timing is unavailable', () => {
    const gcode = 'G21 G90\nG28\nG1 X10 F600';
    expect(buildProgramDuration(gcode, LIMITS)).toEqual(buildProgramTimeline(gcode, LIMITS));
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
