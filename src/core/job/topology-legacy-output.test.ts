import { describe, expect, it } from 'vitest';
import {
  historicalNestingJob,
  mixedOpenProject,
  nativeArcProject,
  repeatedPowerProject,
  topologyOptimization,
  uniformFillProject,
  uniformLineProject,
  sharedEdgeDrawnProject,
} from '../../__fixtures__/topology-archive';
import { PRE_K1_BYTES, PRE_K1_FINGERPRINTS } from '../../__fixtures__/topology-legacy-bytes';
import { fingerprintGcode } from '../recovery';
import { emitPreparedGcode } from '../../io/gcode';
import { compileJob } from './compile-job';
import { optimizePaths } from './optimize-paths';

describe('pre-K1 ordinary output and historical Job bytes', () => {
  it.each(['repeated-source', 'repeated-no-inside'] as const)(
    '%s preserves A80/B40/C80 traversal and pass boundaries',
    (key) => {
      const project = repeatedPowerProject();
      const compiled = compileJob(project.scene, project.device);
      expect(compiled.groups.map((g) => (g.kind === 'cut' ? g.power : null))).toEqual([80, 40, 80]);
      expect(
        compiled.groups.map((g) => (g.kind === 'cut' ? g.segments[0]?.polyline[0]?.x : null)),
      ).toEqual([10, 40, 70]);
      const settings =
        key === 'repeated-source'
          ? { ...topologyOptimization, travelPolicy: 'source-order' as const }
          : { ...topologyOptimization, insideFirst: false };
      const job = optimizePaths(compiled, settings, [], project.device.origin);
      const gcode = emitPreparedGcode({
        ok: true,
        project,
        job,
        jobOriginOffset: { x: 0, y: 0 },
      }).gcode;
      expect(gcode).toBe(PRE_K1_BYTES[key]);
      expect(fingerprintGcode(gcode)).toEqual(PRE_K1_FINGERPRINTS[key]);
    },
  );
  it.each([
    ['native-arc', nativeArcProject],
    ['mixed-open', mixedOpenProject],
    ['uniform-fill', uniformFillProject],
    ['uniform-line-passes', uniformLineProject],
    ['one-pass-cleanup', sharedEdgeDrawnProject],
  ] as const)('%s preserves uniform geometry and one-pass original opens', (key, makeProject) => {
    const project = makeProject();
    const job = optimizePaths(
      compileJob(project.scene, project.device),
      project.optimization,
      [],
      project.device.origin,
    );
    const gcode = emitPreparedGcode({
      ok: true,
      project,
      job,
      jobOriginOffset: { x: 0, y: 0 },
    }).gcode;
    if (key === 'mixed-open') {
      // ADR-669 reroutes this sealed program: the same burns, in a part-major,
      // park-scored order that travels no further than the sealed one did.
      expect(burnMoves(gcode)).toEqual(burnMoves(PRE_K1_BYTES[key]));
      expect(rapidMm(gcode)).toBeLessThanOrEqual(rapidMm(PRE_K1_BYTES[key]));
    } else {
      expect(gcode).toBe(PRE_K1_BYTES[key]);
      expect(fingerprintGcode(gcode)).toEqual(PRE_K1_FINGERPRINTS[key]);
    }
    if (key === 'native-arc') expect(gcode).toMatch(/^G[23] /m);
    if (key === 'mixed-open')
      expect(
        job.groups.flatMap((g) => (g.kind === 'cut' ? g.segments.filter((s) => !s.closed) : [])),
      ).toHaveLength(2);
  });
  it('old nesting/process/source metadata does not opt a stored Job into new cross-group ordering', () => {
    const project = repeatedPowerProject(),
      old = historicalNestingJob();
    expect(
      old.groups.every(
        (g) =>
          g.kind === 'cut' &&
          g.topologyScope === undefined &&
          g.segments.every((s) => s.nesting?.topologyContour === undefined),
      ),
    ).toBe(true);
    const job = optimizePaths(old, topologyOptimization, [], project.device.origin);
    const gcode = emitPreparedGcode({
      ok: true,
      project,
      job,
      jobOriginOffset: { x: 0, y: 0 },
    }).gcode;
    expect(gcode).toBe(PRE_K1_BYTES['historical-nesting']);
    expect(fingerprintGcode(gcode)).toEqual(PRE_K1_FINGERPRINTS['historical-nesting']);
  });
});

// Absolute G0/G1 XY programs only, with modal feed and power.
type Move = { rapid: boolean; from: string; to: string; mm: number; words: string };
function moves(gcode: string): Move[] {
  const out: Move[] = [];
  let x = 0,
    y = 0,
    feed = '',
    power = '';
  for (const line of gcode.split('\n')) {
    feed = /F([\d.]+)/.exec(line)?.[1] ?? feed;
    power = /S([\d.]+)/.exec(line)?.[1] ?? power;
    const motion = /^G([01]) /.exec(line);
    if (motion === null) continue;
    const nx = Number(/X(-?[\d.]+)/.exec(line)?.[1] ?? x);
    const ny = Number(/Y(-?[\d.]+)/.exec(line)?.[1] ?? y);
    out.push({
      rapid: motion[1] === '0',
      from: `${x},${y}`,
      to: `${nx},${ny}`,
      mm: Math.hypot(nx - x, ny - y),
      words: `F${feed} S${power}`,
    });
    x = nx;
    y = ny;
  }
  return out;
}
// Each burn as an undirected endpoint pair with its words, sorted, so order
// and direction drop out.
function burnMoves(gcode: string): string[] {
  return moves(gcode)
    .filter((move) => !move.rapid)
    .map((move) => `${[move.from, move.to].sort().join('|')} ${move.words}`)
    .sort();
}
function rapidMm(gcode: string): number {
  return moves(gcode)
    .filter((move) => move.rapid)
    .reduce((total, move) => total + move.mm, 0);
}
