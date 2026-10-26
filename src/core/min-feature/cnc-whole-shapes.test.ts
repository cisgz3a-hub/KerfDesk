// ADR-433 Amendment 3 (meta audit v1 M6-P2-2): a closed hole smaller than half
// the bit, on a Pocket or Inside-profile layer, compiles to nothing, yet the
// speck rule dropped it while a slightly larger hole warned. A bit drops such a
// shape whole, so on CNC it is a feature however small. Laser specks are
// unchanged.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../cnc';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncCutType,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  type Vec2,
} from '../scene';
import { checkProjectMinimumFeatures } from './project-check';

function circle(cx: number, cy: number, diameter: number, sides = 48): Polyline {
  const points: Vec2[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (2 * Math.PI * i) / sides;
    points.push({
      x: cx + (diameter / 2) * Math.cos(angle),
      y: cy + (diameter / 2) * Math.sin(angle),
    });
  }
  return { closed: true, points };
}

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function artwork(polylines: ReadonlyArray<Polyline>): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'part',
    source: 'part.svg',
    operationIds: ['cnc'],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', operationIds: ['cnc'], polylines }],
  };
}

/** A 1/4" end mill, as the audit's screw-hole scene used. */
function cncProject(cutType: CncCutType, polylines: ReadonlyArray<Polyline>): Project {
  const layer: Layer = {
    ...createLayer({ id: 'cnc', color: '#000000' }),
    name: 'Router',
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType, toolId: 'em-6350', depthMm: 3 },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [artwork(polylines)], layers: [layer] },
  };
}

function cuts(project: Project): number {
  const job = compileCncJob(project.scene, project.device, DEFAULT_CNC_MACHINE_CONFIG);
  return job.groups.reduce(
    (sum, group) => sum + (group.kind === 'cnc' ? group.passes.length : 0),
    0,
  );
}

describe('CNC whole shapes the bit cannot enter (ADR-433 Amendment 3)', () => {
  it.each(['pocket', 'profile-inside'] as const)(
    'reports a 2 mm screw hole on a 1/4" %s layer, which compiles to nothing',
    (cutType) => {
      const project = cncProject(cutType, [circle(20, 20, 2)]);
      expect(cuts(project)).toBe(0);
      const [report] = checkProjectMinimumFeatures(project);
      expect(report?.analysis.widths.count).toBe(1);
      expect(report?.analysis.widths.minWidthMm).toBeCloseTo(2, 1);
      expect(report?.analysis.widths.sites[0]?.at.x).toBeCloseTo(20, 1);
    },
  );

  it('reports each of several holes under half the bit, narrowest first', () => {
    const holes = [circle(20, 20, 3), circle(40, 20, 1), circle(60, 20, 2)];
    const [report] = checkProjectMinimumFeatures(cncProject('pocket', holes));
    expect(report?.analysis.widths.count).toBe(3);
    expect(report?.analysis.widths.sites.map((site) => Math.round(site.widthMm))).toEqual([
      1, 2, 3,
    ]);
  });

  it('reports a small triangle, whose edges all meet at corners', () => {
    const triangle: Polyline = {
      closed: true,
      points: [
        { x: 10, y: 10 },
        { x: 13, y: 10 },
        { x: 10, y: 14 },
      ],
    };
    const [report] = checkProjectMinimumFeatures(cncProject('pocket', [triangle]));
    expect(report?.analysis.widths.count).toBe(1);
    // A 3-4-5 triangle's inscribed circle is 2 mm across: 4 · 6 / 12.
    expect(report?.analysis.widths.minWidthMm).toBeCloseTo(2, 9);
  });

  it('keeps an island the pocket clears around, and a part an Outside profile frees', () => {
    const island = [rectangle(0, 0, 60, 60), circle(30, 30, 2)];
    const [pocket] = checkProjectMinimumFeatures(cncProject('pocket', island));
    expect(pocket?.analysis.widths.count).toBe(0);
    const [outside] = checkProjectMinimumFeatures(
      cncProject('profile-outside', [circle(20, 20, 2)]),
    );
    expect(outside?.analysis.gaps.count).toBe(0);
  });

  it('reports a small hole in a plate cut with an Outside profile, which it leaves uncut', () => {
    const plate = [rectangle(0, 0, 60, 60), circle(30, 30, 2)];
    const [report] = checkProjectMinimumFeatures(cncProject('profile-outside', plate));
    expect(report?.analysis.gaps.count).toBe(1);
    expect(report?.analysis.gaps.minWidthMm).toBeCloseTo(2, 1);
  });

  it('still drops a laser speck the beam rounds off', () => {
    const { laserSubProfile: _head, ...device } = DEFAULT_DEVICE_PROFILE;
    const operation: Layer = {
      ...createLayer({ id: 'cnc', color: '#000000' }),
      name: 'Cut',
      mode: 'line',
      kerfOffsetMm: 0.075,
    };
    const project: Project = {
      ...createProject(device),
      scene: { objects: [artwork([circle(20, 20, 0.05)])], layers: [operation] },
    };
    const [report] = checkProjectMinimumFeatures(project);
    expect(report?.analysis.widths.count).toBe(0);
  });
});
