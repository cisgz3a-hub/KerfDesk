import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Polyline,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { restAwareVCarveGroup } from './vcarve-rest-finishing';
import {
  coneRemovedDepth,
  cuttingXyLength,
  emittedFeedChords,
  flatRemovedDepth,
  sourceContains,
  type RemovalChord,
} from './vcarve-removal.test-support';

const VBIT: CncTool = {
  id: 'v',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};
const CLEAR: CncTool = { id: 'clear', name: '3 mm flat end mill', kind: 'end-mill', diameterMm: 3 };
const square = (x: number, y: number, width: number): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + width },
    { x, y: y + width },
  ],
});

function compile(
  loops: ReadonlyArray<Polyline>,
  clearing: boolean,
  tool = VBIT,
  stepoverPercent = 40,
  depthPerPassMm = 1,
  legacyFlatDepth = false,
): Job {
  const scene: Scene = {
    objects: [
      {
        kind: 'imported-svg',
        id: 'shape',
        source: 'shape.svg',
        bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines: loops }],
      },
    ],
    layers: [
      {
        ...createLayer({ id: 'cut', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          toolId: tool.id,
          vCarveFlatDepthEnabled: true,
          depthMm: 1,
          depthPerPassMm,
          stepoverPercent,
          ...(clearing ? { vClearToolId: CLEAR.id } : {}),
        },
      },
    ],
  };
  const input = legacyFlatDepth
    ? {
        ...scene,
        layers: scene.layers.map((layer) => {
          const { vCarveFlatDepthEnabled: _mode, ...settings } =
            layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
          return { ...layer, cnc: settings };
        }),
      }
    : scene;
  return compileCncJob(input, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [tool, CLEAR],
    toolId: tool.id,
  });
}

function group(job: Job, cutType: 'v-carve' | 'pocket'): CncGroup {
  const found = job.groups.find(
    (candidate) => candidate.kind === 'cnc' && candidate.cutType === cutType,
  );
  if (found?.kind !== 'cnc') throw new Error(`Missing ${cutType}`);
  return found;
}

function chords(job: Job, cutType: 'v-carve' | 'pocket'): RemovalChord[] {
  return emittedFeedChords(
    cncGrblStrategy.emit({ ...job, groups: [group(job, cutType)] }, DEFAULT_DEVICE_PROFILE),
  );
}

describe('V-carve finish justified by actual clearing-tool removal', () => {
  it('shortens the audited square while retaining finish stock outside the clearing sweep', () => {
    const loops = [square(10, 10, 20)];
    const alone = compile(loops, false);
    const cleared = compile(loops, true);
    const before = cuttingXyLength(chords(alone, 'v-carve'));
    const after = cuttingXyLength(chords(cleared, 'v-carve'));
    expect(before).toBeCloseTo(3414.592929, 3);
    expect(after).toBeLessThan(before * 0.45);
    expect(after).toBeGreaterThan(100);
    expect(
      cleared.groups.map((candidate) => (candidate.kind === 'cnc' ? candidate.toolId : '')),
    ).toEqual([CLEAR.id, VBIT.id]);
    const flat = chords(cleared, 'pocket');
    const finish = chords(cleared, 'v-carve');
    const nearCorner = toMachineCoords({ x: 11.1, y: 11.1 }, DEFAULT_DEVICE_PROFILE);
    expect(flatRemovedDepth(nearCorner, flat, 3)).toBe(0);
    expect(coneRemovedDepth(nearCorner, finish, 90)).toBeGreaterThan(0.97);
  });

  it.each([
    {
      name: 'acute cutter and fractional depth steps',
      loops: [square(10, 10, 20)],
      tool: { ...VBIT, tipAngleDeg: 60 },
      stepover: 40,
    },
    { name: 'square', loops: [square(10, 10, 20)], tool: VBIT, stepover: 40 },
    {
      name: 'hole and nested island',
      loops: [square(10, 10, 20), square(16, 16, 8), square(18, 18, 4)],
      tool: VBIT,
      stepover: 80,
    },
    {
      name: 'narrow sibling unreachable to the clearing bit',
      loops: [square(10, 10, 16), square(27, 10, 2)],
      tool: VBIT,
      stepover: 40,
    },
    {
      name: 'truncated cone and sparse clearing',
      loops: [square(10, 10, 20)],
      tool: { ...VBIT, kind: 'engraving' as const, tipDiameterMm: 0.4 },
      stepover: 125,
    },
  ])(
    'retains independent sampled removal with $name',
    ({ loops, tool, stepover }) => {
      const alone = compile(loops, false, tool, stepover, 0.33337);
      const cleared = compile(loops, true, tool, stepover, 0.33337);
      const before = chords(alone, 'v-carve');
      const finish = chords(cleared, 'v-carve');
      const flat = chords(cleared, 'pocket');
      let points = 0;
      let worstLoss = 0;
      let worstExtra = 0;
      for (let iy = 0; iy < 27; iy += 1)
        for (let ix = 0; ix < 27; ix += 1) {
          const q = { x: 9.73 + ix * 0.81, y: 9.81 + iy * 0.79 };
          if (!sourceContains(q, loops)) continue;
          points += 1;
          const machine = toMachineCoords(q, DEFAULT_DEVICE_PROFILE);
          const original = Math.max(
            coneRemovedDepth(machine, before, tool.tipAngleDeg ?? 90, tool.tipDiameterMm),
            flatRemovedDepth(machine, flat, 3),
          );
          const actual = Math.max(
            coneRemovedDepth(machine, finish, tool.tipAngleDeg ?? 90, tool.tipDiameterMm),
            flatRemovedDepth(machine, flat, 3),
          );
          worstLoss = Math.max(worstLoss, original - actual);
          worstExtra = Math.max(worstExtra, actual - original);
        }
      expect(points).toBeGreaterThan(250);
      expect(worstLoss).toBeLessThanOrEqual(0.002);
      expect(worstExtra).toBeLessThanOrEqual(0.002);
      expect(Math.min(...finish.flatMap(([a, b]) => [a.z, b.z]))).toBeGreaterThanOrEqual(-1);
    },
    60_000,
  );

  it('keeps the full finish when the actual clearing stage is absent, shallow or belongs elsewhere', () => {
    const job = compile([square(10, 10, 20)], false);
    const finish = group(job, 'v-carve');
    const clear = group(compile([square(10, 10, 20)], true), 'pocket');
    expect(restAwareVCarveGroup(finish, [])).toBe(finish);
    expect(restAwareVCarveGroup(finish, [{ ...clear, layerId: 'different' }])).toBe(finish);
    const shallow = {
      ...clear,
      passes: clear.passes.map((pass) => (pass.kind === 'contour' ? { ...pass, zMm: -0.2 } : pass)),
    };
    expect(restAwareVCarveGroup(finish, [shallow], [square(10, 10, 20)]).passes).toEqual(
      finish.passes,
    );
  });

  it('honours legacy implicit flat-depth mode with the same real clearing ownership', () => {
    const loops = [square(10, 10, 20)];
    const current = compile(loops, true);
    const legacy = compile(loops, true, VBIT, 40, 1, true);
    expect(group(legacy, 'v-carve').passes).toEqual(group(current, 'v-carve').passes);
    expect(group(legacy, 'pocket').passes).toEqual(group(current, 'pocket').passes);
  });

  it('follows emitted path3d vertices without inventing an implicit closing chord', () => {
    const loops = [square(10, 10, 20)];
    const job = compile(loops, true);
    const clear = group(job, 'pocket');
    const finish = {
      ...group(job, 'v-carve'),
      passes: [
        {
          kind: 'path3d' as const,
          closed: true,
          points: [
            { x: 12, y: 372, z: -1 },
            { x: 28, y: 372, z: -1 },
            { x: 28, y: 388, z: -1 },
          ],
        },
      ],
    };
    const machineSource = loops.map((loop) => ({
      ...loop,
      points: loop.points.map((p) => toMachineCoords(p, DEFAULT_DEVICE_PROFILE)),
    }));
    const open = { ...finish, passes: finish.passes.map((pass) => ({ ...pass, closed: false })) };
    const program = (candidate: CncGroup) =>
      cncGrblStrategy.emit({ ...job, groups: [candidate] }, DEFAULT_DEVICE_PROFILE);
    expect(emittedFeedChords(program(finish))).toEqual(emittedFeedChords(program(open)));
    expect(
      emittedFeedChords(program(restAwareVCarveGroup(finish, [clear], machineSource))),
    ).toEqual(emittedFeedChords(program(restAwareVCarveGroup(open, [clear], machineSource))));
  });

  it('does not claim material removed by an un-emitted clearing-contour closing edge', () => {
    const loops = [square(10, 10, 20)];
    const job = compile(loops, true);
    const finish = {
      ...group(job, 'v-carve'),
      passes: [
        {
          kind: 'path3d' as const,
          closed: false,
          points: [
            { x: 19.8, y: 380, z: -1 },
            { x: 20.2, y: 380, z: -1 },
          ],
        },
      ],
    };
    const clear = {
      ...group(job, 'pocket'),
      passes: [
        {
          kind: 'contour' as const,
          closed: true,
          zMm: -1,
          polyline: [
            { x: 12, y: 378 },
            { x: 28, y: 378 },
            { x: 28, y: 382 },
          ],
        },
      ],
    };
    const source = loops.map((loop) => ({
      ...loop,
      points: loop.points.map((p) => toMachineCoords(p, DEFAULT_DEVICE_PROFILE)),
    }));
    expect(restAwareVCarveGroup(finish, [clear], source).passes).toEqual(finish.passes);
  });
});
