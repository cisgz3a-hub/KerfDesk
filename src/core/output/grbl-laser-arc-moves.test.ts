// ADR-432: the laser GRBL emitter writes fitted arc moves as G2/G3 on
// arc-capable machines, with the G1 path's power, feed and modal semantics,
// and stays byte-identical G1 everywhere else.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { ArcMove } from '../geometry/arc-fit';
import type { CutGroup, CutSegment, Job } from '../job';
import { withCutArcMoves } from '../job/cut-arc-moves';
import { parseGcodeProgram } from '../../io/gcode/parse-gcode-program';
import { grblStrategy } from './grbl-strategy';

const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };

// Two clockwise quarter turns about (20, 20), radius 10, then a line.
const QUARTERS: ReadonlyArray<ArcMove> = [
  { kind: 'arc', to: { x: 20, y: 30 }, center: { x: 20, y: 20 }, clockwise: true },
  { kind: 'arc', to: { x: 30, y: 20 }, center: { x: 20, y: 20 }, clockwise: true },
  { kind: 'line', to: { x: 40, y: 20 } },
];

function chordsOf(): CutSegment['polyline'] {
  const points = [];
  for (let step = 0; step <= 16; step += 1) {
    const angle = Math.PI - (step * Math.PI) / 16;
    points.push({ x: 20 + 10 * Math.cos(angle), y: 20 + 10 * Math.sin(angle) });
  }
  points[0] = { x: 10, y: 20 };
  points[16] = { x: 30, y: 20 };
  return [...points, { x: 40, y: 20 }];
}

function jobWith(segment: CutSegment, group: Partial<CutGroup> = {}): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#ff0000',
        power: 50,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [segment],
        ...group,
      },
    ],
  };
}

const PLAIN_SEGMENT: CutSegment = { polyline: chordsOf(), closed: false };
const ARC_SEGMENT: CutSegment = withCutArcMoves(PLAIN_SEGMENT, QUARTERS);

function body(gcode: string): string[] {
  return gcode.split('\n').filter((line) => /^G[0-3] /.test(line));
}

describe('grblStrategy laser arc moves (ADR-432)', () => {
  it('writes G2/G3 with I/J from the rounded start and F/S on the first burn move only', () => {
    expect(body(grblStrategy.emit(jobWith(ARC_SEGMENT), ARC_DEVICE))).toEqual([
      'G0 X10.000 Y20.000 S0',
      'G2 X20.000 Y30.000 I10.000 J0.000 F1500 S500',
      'G2 X30.000 Y20.000 I0.000 J-10.000',
      'G1 X40.000 Y20.000',
      'G0 X0.000 Y0.000 S0',
    ]);
  });

  it('keeps the preamble, power mode, passes and air assist of the G1 program', () => {
    const job = jobWith(ARC_SEGMENT, { passes: 2, airAssist: true, powerMode: 'constant' });
    const device = { ...ARC_DEVICE, airAssistCommand: 'M8' as const };
    const arcs = grblStrategy.emit(job, device).split('\n');
    const lines = grblStrategy
      .emit(jobWith(PLAIN_SEGMENT, { passes: 2, airAssist: true, powerMode: 'constant' }), device)
      .split('\n');
    const notMotion = (line: string): boolean => !/^G[0-3] /.test(line);
    // The only preamble difference is the G17 plane pin, and only with arcs.
    expect(arcs.filter(notMotion).filter((line) => line !== 'G17')).toEqual(
      lines.filter(notMotion),
    );
    expect(arcs.filter((line) => line.startsWith('G2 ')).length).toBe(4);
  });

  it('selects the G17 plane before the first arc, and only when the job writes arcs', () => {
    const arcs = grblStrategy.emit(jobWith(ARC_SEGMENT), ARC_DEVICE).split('\n');
    expect(arcs.slice(0, 6)).toEqual(['G21', 'G90', 'G54', 'G94', 'G17', 'M4 S0']);
    const firstArc = arcs.findIndex((line) => /^G[23] /.test(line));
    expect(arcs.indexOf('G17')).toBeGreaterThanOrEqual(0);
    expect(arcs.indexOf('G17')).toBeLessThan(firstArc);
    for (const device of [ARC_DEVICE, { ...ARC_DEVICE, laserArcMoves: 'off' as const }]) {
      expect(grblStrategy.emit(jobWith(PLAIN_SEGMENT), device)).not.toMatch(/^G17$/m);
    }
    expect(grblStrategy.emit(jobWith(ARC_SEGMENT, { entryRunwayMm: 2 }), ARC_DEVICE)).not.toMatch(
      /^G17$/m,
    );
  });

  it('emits byte-identical G1 output where arcs are not enabled', () => {
    const offDevices: ReadonlyArray<DeviceProfile> = [
      DEFAULT_DEVICE_PROFILE,
      { ...ARC_DEVICE, laserArcMoves: 'off' },
      { ...ARC_DEVICE, gcodeDialect: { dialectId: 'neotronics-4040-safe' } },
      { ...ARC_DEVICE, controllerCommandSet: 'creality-falcon-a1-pro' },
    ];
    for (const device of offDevices) {
      const withArcs = grblStrategy.emit(jobWith(ARC_SEGMENT), device);
      expect(withArcs).toBe(grblStrategy.emit(jobWith(PLAIN_SEGMENT), device));
      expect(withArcs).not.toMatch(/^G[23] /m);
    }
  });

  it('keeps G1 for a contour with a tangential entry runway', () => {
    const job = jobWith(ARC_SEGMENT, { entryRunwayMm: 2 });
    expect(grblStrategy.emit(job, ARC_DEVICE)).toBe(
      grblStrategy.emit(jobWith(PLAIN_SEGMENT, { entryRunwayMm: 2 }), ARC_DEVICE),
    );
  });

  it('ignores arc moves that no longer end on the polyline', () => {
    const moved: CutSegment = {
      ...ARC_SEGMENT,
      polyline: ARC_SEGMENT.polyline.map((point) => ({ x: point.x + 1, y: point.y })),
    };
    const plain: CutSegment = { polyline: moved.polyline, closed: false };
    expect(grblStrategy.emit(jobWith(moved), ARC_DEVICE)).toBe(
      grblStrategy.emit(jobWith(plain), ARC_DEVICE),
    );
  });

  it('parses back through the app parser as the same path', () => {
    const parsed = parseGcodeProgram(grblStrategy.emit(jobWith(ARC_SEGMENT), ARC_DEVICE));
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    expect(parsed.summary.cutMm).toBeCloseTo(10 * Math.PI + 10, 2);
  });

  it('never lets rounding turn a tiny arc into a full circle', () => {
    for (const radius of [0.06, 0.1, 1, 100, 900]) {
      for (const chord of [0.0006, 0.0011, 0.0019, 0.003, 0.02]) {
        for (const clockwise of [true, false]) {
          const half = chord / 2;
          const rise = Math.sqrt(radius * radius - half * half);
          const start = { x: 5.0004, y: 7.0003 };
          const end = { x: start.x + chord, y: start.y };
          const center = { x: start.x + half, y: start.y + (clockwise ? -rise : rise) };
          const segment = withCutArcMoves(
            { polyline: [{ x: 0, y: 7 }, start, end], closed: false },
            [
              { kind: 'line', to: start },
              { kind: 'arc', to: end, center, clockwise },
            ],
          );
          const parsed = parseGcodeProgram(grblStrategy.emit(jobWith(segment), ARC_DEVICE));
          if (parsed.kind !== 'ok') throw new Error(parsed.reason);
          expect(parsed.summary.cutMm).toBeLessThan(5.0004 + chord + 0.01);
        }
      }
    }
  });
});
