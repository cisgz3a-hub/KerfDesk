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
    expect(gcode).toBe(PRE_K1_BYTES[key]);
    expect(fingerprintGcode(gcode)).toEqual(PRE_K1_FINGERPRINTS[key]);
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
