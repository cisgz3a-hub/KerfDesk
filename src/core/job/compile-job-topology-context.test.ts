import { describe, expect, it } from 'vitest';
import {
  archiveTopologyProject,
  topologyProject,
  topologyArtwork,
  sharedEdgeDrawnProject,
  topologyRectangle,
} from '../../__fixtures__/topology-archive';
import { burns, burnLength } from '../../__fixtures__/frame-process-output';
import { compileJob } from './compile-job';
import { grblStrategy } from '../output/grbl-strategy';
import { optimizePaths } from './optimize-paths';

function openDepthProject(withHole = false) {
  const base = archiveTopologyProject(),
    layer = base.scene.layers[0];
  if (layer === undefined) throw new Error('Missing layer');
  const inside = withHole ? { x: 15, y: 15 } : { x: 12, y: 12 };
  const artwork = {
    ...topologyArtwork('mixed-depth', 10, 20),
    paths: [
      {
        color: '#000000',
        polylines: [
          topologyRectangle(10, 10, 20),
          ...(withHole ? [topologyRectangle(14, 14, 8)] : []),
          { closed: false, points: [inside, { x: inside.x + 4, y: inside.y }] },
          {
            closed: false,
            points: [
              { x: 40, y: 12 },
              { x: 44, y: 12 },
            ],
          },
        ],
      },
    ],
  };
  return topologyProject(
    [artwork],
    [{ ...layer, tabsEnabled: false, perforationEnabled: false, passes: 2 }],
  );
}
function expectPlainJob(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.getOwnPropertySymbols(value)).toEqual([]);
  expect(value).not.toBeInstanceOf(Map);
  expect(value).not.toBeInstanceOf(Set);
  for (const child of Object.values(value)) expectPlainJob(child);
}

describe('compiled whole-run contour context', () => {
  it('automatic skip-inner tabs use the actual hole depth across process settings', () => {
    const base = archiveTopologyProject();
    const project = {
      ...base,
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer) => ({
          ...layer,
          passes: 1,
          perforationEnabled: false,
          tabSkipInnerShapes: true,
        })),
      },
    };
    const job = compileJob(project.scene, project.device);
    const hole = job.groups.filter((g) => g.kind === 'cut' && g.speed === 600);
    expect(hole).toHaveLength(1);
    expect(hole[0]?.kind === 'cut' && hole[0].segments[0]?.closed).toBe(true);
    expect(hole[0]?.kind === 'cut' && hole[0].segments[0]?.nesting?.depth).toBe(1);
    const planned = optimizePaths(job, project.optimization, [], project.device.origin);
    const gcode = grblStrategy.emit(planned, project.device);
    expect(gcode).toMatch(/G1 .*S400/);
    expect(gcode).not.toMatch(/G1 .*S80(?:\s|$)/);
    expect(
      job.groups.some((g) => g.kind === 'cut' && g.tabSpanPowerPercent === 20 && g.power === 16),
    ).toBe(true);
  });
  it('a placed hole tab still overrides automatic skip-inner eligibility', () => {
    const base = archiveTopologyProject();
    const objects = base.scene.objects.flatMap((object) =>
      object.kind !== 'imported-svg'
        ? []
        : [
            object.id === 'hole'
              ? {
                  ...object,
                  laserTabAnchors: [
                    { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 },
                  ],
                }
              : object,
          ],
    );
    const project = topologyProject(
      objects,
      base.scene.layers.map((layer) => ({
        ...layer,
        perforationEnabled: false,
        tabSkipInnerShapes: true,
      })),
    );
    const job = compileJob(project.scene, project.device);
    expect(
      job.groups.some((g) => g.kind === 'cut' && g.speed === 600 && g.tabSpanPowerPercent === 20),
    ).toBe(true);
  });
  it.each([0, 0.02])(
    'shared-edge cleanup still compares same-process parent contours with tolerance %s',
    (tolerance) => {
      const base = archiveTopologyProject(),
        layer = base.scene.layers[0];
      if (layer === undefined) throw new Error('Missing layer');
      const project = topologyProject(
        [topologyArtwork('A', 10), topologyArtwork('B', 20)],
        [{ ...layer, tabsEnabled: false, perforationEnabled: false, passes: 2 }],
      );
      const compiled = compileJob(project.scene, project.device);
      const planned = optimizePaths(
        compiled,
        {
          ...project.optimization,
          removeOverlappingLines: true,
          overlapMergeToleranceMm: tolerance,
        },
        [],
        project.device.origin,
      );
      expectPlainJob(planned);
      expect(structuredClone(planned)).toEqual(planned);
      const cut = planned.groups.filter((g) => g.kind === 'cut');
      const length = cut.reduce(
        (total, g) =>
          total +
          g.passes *
            g.segments.reduce(
              (sum, s) =>
                sum +
                s.polyline
                  .slice(1)
                  .reduce(
                    (distance, p, i) =>
                      distance +
                      Math.hypot(p.x - (s.polyline[i]?.x ?? p.x), p.y - (s.polyline[i]?.y ?? p.y)),
                    0,
                  ),
              0,
            ),
        0,
      );
      expect(length).toBeCloseTo(140, 8); // two 40 mm loops minus their one shared 10 mm edge, twice
      expect(
        new Set(cut.flatMap((g) => g.segments.map((s) => s.nesting?.topologyContour))).size,
      ).toBe(2);
    },
  );
  it('identical multi-pass loops are cleaned once across parent IDs while cleanup-off keeps both', () => {
    const base = archiveTopologyProject(),
      layer = base.scene.layers[0];
    if (layer === undefined) throw new Error('Missing layer');
    const project = topologyProject(
      [topologyArtwork('A', 10), topologyArtwork('B', 10)],
      [{ ...layer, tabsEnabled: false, perforationEnabled: false, passes: 2 }],
    );
    const compiled = compileJob(project.scene, project.device);
    const enabled = optimizePaths(
      compiled,
      { ...project.optimization, removeOverlappingLines: true },
      [],
      project.device.origin,
    );
    const disabled = optimizePaths(
      compiled,
      { ...project.optimization, removeOverlappingLines: false },
      [],
      project.device.origin,
    );
    expectPlainJob(enabled);
    expectPlainJob(disabled);
    expect(structuredClone(enabled)).toEqual(enabled);
    expect(enabled.groups.flatMap((g) => (g.kind === 'cut' ? g.segments : []))).toHaveLength(1);
    expect(disabled.groups.flatMap((g) => (g.kind === 'cut' ? g.segments : []))).toHaveLength(2);
    expect(enabled.groups.filter((g) => g.kind === 'cut').every((g) => g.passes === 2)).toBe(true);
  });
  it('shared-edge winner follows the globally planned parent route across settings', () => {
    const base = archiveTopologyProject(),
      layer = base.scene.layers[0];
    if (layer === undefined) throw new Error('Missing layer');
    const child = {
      ...topologyArtwork('C', 26, 2),
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 26, y: 12 },
                { x: 28, y: 12 },
                { x: 28, y: 14 },
                { x: 26, y: 14 },
              ],
            },
          ],
        },
      ],
      operationOverride: { byOperation: { cut: { power: 40, speed: 600, passes: 1 } } },
    };
    const project = topologyProject(
      [topologyArtwork('A', 10), topologyArtwork('B', 20), child],
      [{ ...layer, tabsEnabled: false, perforationEnabled: false, passes: 2 }],
    );
    const planned = optimizePaths(
      compileJob(project.scene, project.device),
      {
        ...project.optimization,
        removeOverlappingLines: true,
      },
      [],
      project.device.origin,
    );
    const edges = burns(grblStrategy.emit(planned, project.device));
    const main = edges.filter((edge) => edge.power === 800);
    expect(main[0]?.a).toEqual({ x: 20, y: 10 }); // child C leaves the cursor nearest B
    expect(main[0]?.b).toEqual({ x: 30, y: 10 });
    const shared = main.flatMap((edge, index) =>
      edge.a.x === 20 && edge.b.x === 20 ? [index] : [],
    );
    const aEdges = main.flatMap((edge, index) => (edge.a.x < 20 || edge.b.x < 20 ? [index] : []));
    const firstA = aEdges[0] ?? -1;
    expect(shared).toHaveLength(2); // both B passes own the single shared edge
    // Same-depth peers retain their legacy combined process-group pass loop.
    // Within each pass, B visits first and owns the shared edge; A has 3 edges.
    expect(firstA).toBeGreaterThan(shared[0] ?? Infinity);
    expect(aEdges[3]).toBeGreaterThan(shared[1] ?? Infinity);
    expect(main.reduce((length, edge) => length + burnLength(edge), 0)).toBeCloseTo(140, 8);
    expect(
      edges
        .slice(
          0,
          edges.findIndex((edge) => edge.power === 800),
        )
        .every((edge) => edge.power === 400),
    ).toBe(true);
  });
  it('single-pass shared-edge winner retains the original pre-cleanup drawn traversal', () => {
    const project = sharedEdgeDrawnProject();
    const planned = optimizePaths(
      compileJob(project.scene, project.device),
      {
        ...project.optimization,
        removeOverlappingLines: true,
      },
      [],
      project.device.origin,
    );
    const edges = burns(grblStrategy.emit(planned, project.device));
    expect(edges[0]?.a).toEqual({ x: 10, y: 10 });
    expect(edges[0]?.b).toEqual({ x: 0, y: 10 }); // the earliest contour keeps this edge
    expect(edges.reduce((length, edge) => length + burnLength(edge), 0)).toBeCloseTo(70, 8);
  });
  it.each([false, true])(
    'original-open depth retains interior-stroke order with marked hole %s',
    (withHole) => {
      const project = openDepthProject(withHole);
      const planned = optimizePaths(
        compileJob(project.scene, project.device),
        project.optimization,
        [],
        project.device.origin,
      );
      const edges = burns(grblStrategy.emit(planned, project.device));
      const inside = withHole ? { x: 15, y: 15 } : { x: 12, y: 12 };
      expect(edges[0]?.a).toEqual(inside);
      expect(edges[0]?.b).toEqual({ x: inside.x + 4, y: inside.y });
      expect(edges.filter((edge) => edge.a.x === inside.x && edge.a.y === inside.y)).toHaveLength(
        2,
      );
      expect(edges.reduce((length, edge) => length + burnLength(edge), 0)).toBeCloseTo(
        (withHole ? 120 : 88) * 2,
        8,
      );
      expectPlainJob(planned);
    },
  );
  it('cleanup redistributes original opens at different depths once without leaking runtime identities', () => {
    const project = openDepthProject();
    const planned = optimizePaths(
      compileJob(project.scene, project.device),
      {
        ...project.optimization,
        removeOverlappingLines: true,
      },
      [],
      project.device.origin,
    );
    const edges = burns(grblStrategy.emit(planned, project.device));
    expect(edges[0]?.a).toEqual({ x: 12, y: 12 });
    expect(edges.filter((edge) => edge.a.x === 12 && edge.a.y === 12)).toHaveLength(2);
    expect(edges.filter((edge) => edge.a.x === 40 && edge.a.y === 12)).toHaveLength(2);
    expect(edges.reduce((length, edge) => length + burnLength(edge), 0)).toBeCloseTo(176, 8);
    expectPlainJob(planned);
    expect(structuredClone(planned)).toEqual(planned);
  });
});
