import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
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
import {
  coneRemovedDepth,
  distanceToLine,
  emittedFeedChords,
  sourceEdges,
} from './vcarve-removal.test-support';
import { measureVCarveSourceBoundaryCoverage } from './vcarve-source-boundary-coverage';

function compile(loops: ReadonlyArray<Polyline>, tool: CncTool, detail: number, floor?: number) {
  const scene: Scene = {
    objects: [
      {
        kind: 'imported-svg',
        id: 'source',
        source: 'source.svg',
        bounds: { minX: 0, minY: 0, maxX: 60, maxY: 60 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines: loops }],
      },
    ],
    layers: [
      {
        ...createLayer({ id: 'carve', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          toolId: tool.id,
          vCarveFlatDepthEnabled: floor !== undefined,
          depthMm: floor ?? 1,
          depthPerPassMm: 2,
          vResolutionMm: detail,
        },
      },
    ],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [tool],
    toolId: tool.id,
  });
}

describe('V-carve source-boundary accuracy independent of the sampled reference', () => {
  it.each([0, 11.25, 22.5, 45])(
    'retains every octagon corner at all Detail settings after %s-degree rotation',
    (rotation) => {
      const points = Array.from({ length: 8 }, (_, i) => {
        const angle = ((i * 45 + rotation) * Math.PI) / 180;
        return { x: 40 + 10 * Math.cos(angle), y: 40 + 10 * Math.sin(angle) };
      });
      const loops = [{ closed: true, points }];
      const tool: CncTool = {
        id: 'v90',
        name: '12 mm V-bit',
        kind: 'v-bit',
        diameterMm: 12,
        tipAngleDeg: 90,
      };
      const edges = sourceEdges(loops);
      for (const detail of [0, 0.05, 0.1, 0.5, 1]) {
        const job = compile(loops, tool, detail);
        const chords = emittedFeedChords(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
        for (const vertex of points)
          for (const inwardMm of [0.003, 0.015, 0.05]) {
            const q = {
              x: vertex.x + ((40 - vertex.x) * inwardMm) / 10,
              y: vertex.y + ((40 - vertex.y) * inwardMm) / 10,
            };
            const expectedDepth = Math.min(...edges.map(([a, b]) => distanceToLine(q, a, b)));
            const removed = coneRemovedDepth(
              toMachineCoords(q, DEFAULT_DEVICE_PROFILE),
              chords,
              90,
            );
            // The existing 1.5-micron source/output allowance now also includes
            // the explicit final XY rounding reserve. At 90 degrees its radial
            // allowance equals depth. Keep this independent of planner helpers.
            const depthAllowanceMm = 0.0015 + (Math.SQRT2 * 0.001) / 2;
            expect(
              removed,
              `Detail ${detail}, source vertex ${JSON.stringify(vertex)}`,
            ).toBeGreaterThanOrEqual(expectedDepth - depthAllowanceMm);
          }
        expect(job.cncCompilation?.vcarveOperations[0]?.sourceBoundaryCoverage).toMatchObject({
          sampleCount: 16,
          samplingComplete: true,
        });
      }
    },
  );

  it('measures a source vertex omitted by a hypothetical reference graph', () => {
    const source = [
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
      },
    ];
    const measure = measureVCarveSourceBoundaryCoverage(
      source,
      [
        {
          kind: 'path3d',
          closed: false,
          points: [
            { x: 1, y: 2, z: -1 },
            { x: 3, y: 2, z: -1 },
          ],
        },
      ],
      { tanHalf: 1, tipRadiusMm: 0, outerRadiusMm: 3 },
    );
    expect(measure.maxSampledResidualMm).toBeCloseTo(Math.sqrt(5) - 1, 10);
    expect(measure.sampleCount).toBe(8);
    expect(measure.samplingComplete).toBe(true);
  });

  it('discloses omitted boundary witnesses and absent cutting sweeps without a coverage claim', () => {
    const source = [
      {
        closed: true,
        points: Array.from({ length: 300 }, (_, i) => ({
          x: 10 * Math.cos((i * Math.PI) / 150),
          y: 10 * Math.sin((i * Math.PI) / 150),
        })),
      },
    ];
    const measure = measureVCarveSourceBoundaryCoverage(source, [], {
      tanHalf: 1,
      tipRadiusMm: 0,
      outerRadiusMm: 3,
    });
    expect(measure.sampleCount).toBeLessThanOrEqual(256);
    expect(measure.samplingComplete).toBe(false);
    expect(measure.maxSampledResidualMm).toBeNull();
  });
});

describe('current-engine floor scallops from independent emitted cutter removal', () => {
  it.each([30, 60, 90, 120, 150])(
    'relates %s-degree pointed and truncated floors to current Detail pitch',
    (angle) => {
      const loops = [
        {
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 14 },
            { x: 10, y: 14 },
          ],
        },
      ];
      const slope = Math.sin((angle * Math.PI) / 360) / Math.cos((angle * Math.PI) / 360);
      for (const tip of [0, 0.4])
        for (const detail of [0, 0.05, 0.2]) {
          const tool: CncTool = {
            id: 'angled',
            name: 'conical cutter',
            kind: tip === 0 ? 'v-bit' : 'engraving',
            diameterMm: 6,
            tipAngleDeg: angle,
            ...(tip === 0 ? {} : { tipDiameterMm: tip }),
          };
          const job = compile(loops, tool, detail, 0.25);
          const chords = emittedFeedChords(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
          const pitch = detail === 0 ? 0.1 : detail;
          const bound = Math.max(0, pitch / 2 - tip / 2) / slope + 0.002;
          let worstResidual = 0;
          let deepest = 0;
          for (let i = 0; i < 31; i += 1)
            for (let j = 0; j < 9; j += 1) {
              const point = toMachineCoords(
                { x: 11.123 + i * 0.241, y: 11.117 + j * 0.219 },
                DEFAULT_DEVICE_PROFILE,
              );
              const cut = coneRemovedDepth(point, chords, angle, tip);
              worstResidual = Math.max(worstResidual, 0.25 - cut);
              deepest = Math.max(deepest, cut);
            }
          expect(worstResidual, `Detail ${detail}, tip ${tip}`).toBeLessThanOrEqual(bound);
          expect(deepest).toBeLessThanOrEqual(0.25001);
          if (tip === 0 && detail >= 0.1) expect(worstResidual).toBeGreaterThan(0.005);
        }
    },
    60_000,
  );

  it('bounds the audited narrow 30-degree flat floor by conical scallop height', () => {
    const loops: ReadonlyArray<Polyline> = [
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 1.3, y: 2 },
          { x: 1.3, y: 0.7 },
          { x: 0, y: 0.7 },
        ],
      },
    ];
    const tool: CncTool = {
      id: 'v30-floor',
      name: '30-degree V-bit',
      kind: 'v-bit',
      diameterMm: 6,
      tipAngleDeg: 30,
    };
    const floor = 0.5;
    const slope = Math.sin(Math.PI / 12) / Math.cos(Math.PI / 12);
    const chords = emittedFeedChords(
      cncGrblStrategy.emit(compile(loops, tool, 0, floor), DEFAULT_DEVICE_PROFILE),
    );
    // The audit's actual ridge witness lies inside the depth-clamped core.
    // A pointed bit cannot leave a planar surface between its 0.1 mm paths.
    const probe = { x: 0.26195121951219513, y: 0.5175609756097561 };
    const edges = sourceEdges(loops);
    const sourceDepth = Math.min(...edges.map(([a, b]) => distanceToLine(probe, a, b))) / slope;
    expect(sourceDepth).toBeGreaterThan(floor);
    const removed = coneRemovedDepth(toMachineCoords(probe, DEFAULT_DEVICE_PROFILE), chords, 30);
    const physicalScallop = 0.1 / (2 * slope);
    const representationAllowance = 0.01 / slope + 0.002;
    expect(removed).toBeGreaterThan(0);
    expect(removed).toBeLessThanOrEqual(floor);
    expect(floor - removed).toBeLessThanOrEqual(physicalScallop + representationAllowance);
    expect(floor - removed).toBeGreaterThan(0.1);
  });
});
