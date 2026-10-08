import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { laserArcMovesEnabled } from '../../core/devices/laser-arc-moves';
import { resumeEntryPointMm, resumeTravelMm } from '../../core/controllers/grbl/resume-program';
import type { CutSegment, Job } from '../../core/job/job';
import { compileJob } from '../../core/job/compile-job';
import { validCutArcMoves, withCutArcMoves } from '../../core/job/cut-arc-moves';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { createLayer } from '../../core/scene';
import { ARC_FIT_MAX_SWEEP_RAD, arcSweep, type ArcMove } from '../../core/geometry/arc-fit';
import { parseSvg } from '../svg/parse-svg';

// Generic stock-GRBL profiles use native arcs by default. No manufactured
// firmware capability or vendor-profile override is needed for reachability.
const ARC_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'grbl-v1.1',
};

function emittedArcSpan(gcode: string): { fromLine: number; toLine: number; count: number } {
  const indices = gcode.split('\n').flatMap((line, index) => (/^G[23] /.test(line) ? [index] : []));
  const first = indices[0];
  const last = indices[indices.length - 1];
  expect(first, 'The production native-arc path must be enabled for this fixture').toBeDefined();
  if (first === undefined || last === undefined)
    throw new Error('No supported native arc was emitted');
  return { fromLine: first + 1, toLine: last + 2, count: indices.length };
}

// Bounded analytical oracle for this emitted G21 circle fixture: its explicit
// XY endpoints, I/J offsets and G1 closing pieces. A vector cross/dot angle
// calculates each sweep independently of resumeTravelMm and arc-solve.
function circleFixtureCommandLength(
  from: { readonly x: number; readonly y: number },
  motionLines: ReadonlyArray<string>,
): number {
  let current = from;
  let length = 0;
  for (const line of motionLines) {
    const fields = new Map(
      [...line.matchAll(/\b([XYIJ])(-?\d+(?:\.\d+)?)/g)].map(
        (match) => [match[1] ?? '', Number(match[2])] as const,
      ),
    );
    const x = fields.get('X');
    const y = fields.get('Y');
    if (x === undefined || y === undefined)
      throw new Error('Circle oracle requires explicit XY endpoints');
    const to = { x, y };
    if (/^G[23] /.test(line)) {
      const i = fields.get('I');
      const j = fields.get('J');
      if (i === undefined || j === undefined)
        throw new Error('Circle oracle requires explicit I/J offsets');
      const center = { x: current.x + i, y: current.y + j };
      const a = { x: current.x - center.x, y: current.y - center.y };
      const b = { x: to.x - center.x, y: to.y - center.y };
      let sweep = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
      if (/^G2 /.test(line) && sweep >= 0) sweep -= 2 * Math.PI;
      if (/^G3 /.test(line) && sweep <= 0) sweep += 2 * Math.PI;
      length += Math.hypot(a.x, a.y) * Math.abs(sweep);
    } else {
      length += Math.hypot(to.x - current.x, to.y - current.y);
    }
    current = to;
  }
  return length;
}
describe('R1 production native arc reachability', () => {
  it('reports true path length for two supported quarter arcs written by the real GRBL emitter', () => {
    expect(laserArcMovesEnabled(ARC_DEVICE)).toBe(true);
    const polyline = Array.from({ length: 65 }, (_, index) => {
      const angle = Math.PI - (index * Math.PI) / 64;
      return { x: 20 + 10 * Math.cos(angle), y: 20 + 10 * Math.sin(angle) };
    });
    polyline[0] = { x: 10, y: 20 };
    polyline[64] = { x: 30, y: 20 };
    const arcs: ReadonlyArray<ArcMove> = [
      { kind: 'arc', to: { x: 20, y: 30 }, center: { x: 20, y: 20 }, clockwise: true },
      { kind: 'arc', to: { x: 30, y: 20 }, center: { x: 20, y: 20 }, clockwise: true },
    ];
    const segment: CutSegment = withCutArcMoves({ polyline, closed: false }, arcs);
    expect(validCutArcMoves(segment)).toHaveLength(2);
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#000000',
          power: 50,
          speed: 1500,
          passes: 1,
          airAssist: false,
          segments: [segment],
        },
      ],
    };
    const gcode = grblStrategy.emit(job, ARC_DEVICE);
    const span = emittedArcSpan(gcode);
    expect(span.count).toBe(2);
    expect(gcode.split('\n').slice(span.fromLine - 1, span.toLine - 1)).toEqual([
      'G2 X20.000 Y30.000 I10.000 J0.000 F1500 S500',
      'G2 X30.000 Y20.000 I0.000 J-10.000',
    ]);
    expect(resumeEntryPointMm(gcode, span.fromLine)).toEqual({ x: 10, y: 20 });
    expect(resumeEntryPointMm(gcode, span.toLine)).toEqual({ x: 30, y: 20 });
    expect(resumeTravelMm(gcode, span.fromLine, span.toLine)).toBeCloseTo(10 * Math.PI, 9);
  });

  it('reports the actual arc-plus-line path of an ordinary SVG circle after production compilation', () => {
    expect(laserArcMovesEnabled(ARC_DEVICE)).toBe(true);
    const imported = parseSvg({
      id: 'r1-circle',
      source: 'circle.svg',
      svgText:
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle cx="50" cy="40" r="10" fill="none" stroke="#000000"/></svg>',
    });
    if (imported.object === null) throw new Error('The ordinary SVG circle must import');
    const job = compileJob(
      {
        objects: [imported.object],
        layers: [createLayer({ id: 'L1', color: '#000000' })],
      },
      ARC_DEVICE,
    );
    let nativeArcs = 0;
    for (const group of job.groups) {
      if (group.kind !== 'cut') continue;
      for (const segment of group.segments) {
        const moves = validCutArcMoves(segment);
        expect(moves).not.toBeNull();
        let from = segment.polyline[0];
        if (from === undefined || moves === null)
          throw new Error('Compiled circle needs supported arc moves');
        for (const move of moves) {
          if (move.kind === 'arc') {
            nativeArcs += 1;
            // Validity only, not the expected distance oracle: every actual
            // emitted arc stays inside production's 179-degree ceiling.
            expect(arcSweep(from, move.to, move.center, move.clockwise)).toBeLessThanOrEqual(
              ARC_FIT_MAX_SWEEP_RAD + 1e-9,
            );
          }
          from = move.to;
        }
      }
    }
    expect(nativeArcs).toBeGreaterThanOrEqual(2);
    const gcode = grblStrategy.emit(job, ARC_DEVICE);
    const span = emittedArcSpan(gcode);
    expect(span.count).toBe(nativeArcs);
    expect(span.count).toBeLessThanOrEqual(4);
    // The 179-degree cap can leave small G1 pieces at the beginning/end of
    // this closed curve. Include every burn-motion block, not merely the
    // first-to-last-arc interval, when comparing with a full circumference.
    const burnIndices = gcode
      .split('\n')
      .flatMap((line, index) => (/^G[123](?:\s|$)/.test(line) ? [index] : []));
    const firstBurn = burnIndices[0];
    const lastBurn = burnIndices[burnIndices.length - 1];
    if (firstBurn === undefined || lastBurn === undefined)
      throw new Error('Compiled circle must burn');
    const fromLine = firstBurn + 1;
    const toLine = lastBurn + 2;
    const entry = resumeEntryPointMm(gcode, fromLine);
    expect(entry).not.toBeNull();
    if (entry === null) throw new Error('Compiled circle must have a known entry point');
    expect(resumeEntryPointMm(gcode, toLine)).toEqual(entry);
    const commandedLength = circleFixtureCommandLength(
      entry,
      gcode.split('\n').slice(fromLine - 1, toLine - 1),
    );
    // Sanity-check the actual fitted/emitted geometry against the authored
    // radius. The recovery metric is compared with the emitted commands below.
    expect(commandedLength).toBeCloseTo(20 * Math.PI, 1);
    const observed = resumeTravelMm(gcode, fromLine, toLine);
    console.info('R1 ordinary SVG arc-plus-line path', {
      nativeArcs,
      authoredCircumferenceMm: 20 * Math.PI,
      commandedLengthMm: commandedLength,
      recoveryTravelMm: observed,
      fromLine,
      toLine,
    });
    expect(observed).toBeCloseTo(commandedLength, 7);
  });
});
