// ADR-250 Amendment 3 (audit 2026-10-21 09-P1-1): a profile lead must keep the
// whole cutter disk out of every part the job keeps, not only out of the other
// contours of its own operation. These cases compile scenes through emitGcode
// and judge the emitted program with an independent disk model.

import { describe, expect, it } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncCutType,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type Vec2,
} from '../../core/scene';
import {
  cuttingMoves,
  minimumCutterClearance,
  type KeptRegion,
} from './cnc-cutter-clearance.test-support';
import { emitGcode } from './emit-gcode';

const EIGHTH_INCH_MM = 3.175;
const QUARTER_INCH_MM = 6.35;
const LEAD_PLUNGE_CODE = 'cnc-profile-lead-plunge';
// The emitter rounds to 0.001 mm and the kerf offset to 0.001 mm, so a contour
// that rides its own wall measures about -0.0005 mm. A gouge is far larger.
const ROUNDING_MM = 0.005;

type Part = {
  readonly id: string;
  readonly layer: string;
  readonly outer: Polyline;
  readonly holes?: ReadonlyArray<Polyline>;
};

function rect(x: number, y: number, width: number, height: number): Polyline {
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

const COLORS: Readonly<Record<string, string>> = { a: '#ff0000', b: '#0000ff' };

function partObject(part: Part): ImportedSvg {
  const xs = part.outer.points.map((point) => point.x);
  const ys = part.outer.points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id: part.id,
    source: `${part.id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [
      { color: COLORS[part.layer] as string, polylines: [part.outer, ...(part.holes ?? [])] },
    ],
  };
}

type CutTypes = Readonly<Record<string, CncCutType>>;

function profileLayer(id: string, toolId: string, cutDepthMm: number, cuts: CutTypes): Layer {
  const cnc: CncLayerSettings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: cuts[id] ?? 'profile-outside',
    toolId,
    depthMm: cutDepthMm,
    depthPerPassMm: 1.5,
    tabsEnabled: false,
  };
  return { ...createLayer({ id, color: COLORS[id] as string }), cnc };
}

function project(
  parts: ReadonlyArray<Part>,
  toolId = 'em-3175',
  depthMm = 3,
  cuts: CutTypes = {},
): Project {
  const layerIds = [...new Set(parts.map((part) => part.layer))];
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: parts.map(partObject),
      layers: layerIds.map((id) => profileLayer(id, toolId, depthMm, cuts)),
    },
  };
}

function keptRegions(source: Project, parts: ReadonlyArray<Part>): ReadonlyArray<KeptRegion> {
  const machine = (polyline: Polyline): ReadonlyArray<Vec2> =>
    polyline.points.map((point) => toMachineCoords(point, source.device));
  return parts.map((part) => ({
    name: part.id,
    outer: machine(part.outer),
    holes: (part.holes ?? []).map(machine),
  }));
}

function emitted(parts: ReadonlyArray<Part>, toolId = 'em-3175', depthMm = 3) {
  const source = project(parts, toolId, depthMm);
  const result = emitGcode(source);
  const radiusMm = (toolId === 'em-6350' ? QUARTER_INCH_MM : EIGHTH_INCH_MM) / 2;
  const clearance = minimumCutterClearance(
    cuttingMoves(result.gcode),
    keptRegions(source, parts),
    radiusMm,
  );
  const leadNotices = result.preflight.issues.filter((issue) => issue.code === LEAD_PLUNGE_CODE);
  return { gcode: result.gcode, clearance, leadNotices, issues: result.preflight.issues };
}

// The audit scene: A's climb start sits mid-way along its edge that faces B.
const PART_A: Part = { id: 'part-a', layer: 'a', outer: rect(20, 20, 40, 30) };
const A_LEAD_PLUNGE = 'G0 X38.413 Y383.175';

function neighbourAbove(gapMm: number, layer: string): Part {
  return { id: 'part-b', layer, outer: rect(30, 20 - gapMm - 10, 20, 10) };
}

describe('CNC profile leads keep the cutter out of other operations’ parts', () => {
  it('reproduces the audit scene: two operations, parts 4 mm apart, 1/8" bit', () => {
    const run = emitted([PART_A, neighbourAbove(4, 'b')]);
    expect(run.clearance.clearanceMm, run.clearance.line).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(run.gcode).not.toContain(A_LEAD_PLUNGE);
    expect(run.leadNotices).toHaveLength(1);
    expect(run.leadNotices[0]?.message).toContain('Layer a:');
  });

  it('keeps the same lead, byte for byte, where the neighbour is far enough away', () => {
    const alone = emitted([PART_A]);
    const far = emitted([PART_A, neighbourAbove(12, 'b')]);
    expect(alone.gcode).toContain(A_LEAD_PLUNGE);
    expect(far.gcode).toContain(A_LEAD_PLUNGE);
    expect(far.leadNotices).toEqual([]);
    expect(far.clearance.clearanceMm).toBeGreaterThanOrEqual(-ROUNDING_MM);
  });

  it('now also discloses the plunge when both parts share one operation', () => {
    const run = emitted([PART_A, neighbourAbove(4, 'a')]);
    expect(run.clearance.clearanceMm).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(run.gcode).not.toContain(A_LEAD_PLUNGE);
    expect(run.leadNotices).toHaveLength(1);
  });

  it('never gouges across the 1/8" gap sweep, and keeps the lead from 3 radii up', () => {
    const radius = EIGHTH_INCH_MM / 2;
    for (let gap = 3.3; gap <= 6.01; gap += 0.1) {
      const run = emitted([PART_A, neighbourAbove(gap, 'b')]);
      const label = `gap ${gap.toFixed(2)}: ${run.clearance.region} ${run.clearance.line}`;
      expect(run.clearance.clearanceMm, label).toBeGreaterThanOrEqual(-ROUNDING_MM);
      if (gap >= 3 * radius + 0.05) expect(run.gcode, label).toContain(A_LEAD_PLUNGE);
      if (gap <= 3 * radius - 0.05) expect(run.leadNotices.length, label).toBeGreaterThan(0);
    }
  });

  it('never gouges with a 1/4" bit at gaps wider than the bit (7, 8 and 9 mm)', () => {
    for (const gap of [7, 8, 9]) {
      const run = emitted([PART_A, neighbourAbove(gap, 'b')], 'em-6350', 6);
      const label = `gap ${gap}: ${run.clearance.region} ${run.clearance.line}`;
      expect(run.clearance.clearanceMm, label).toBeGreaterThanOrEqual(-ROUNDING_MM);
      expect(run.leadNotices.length, label).toBeGreaterThan(0);
    }
    const clear = emitted([PART_A, neighbourAbove(9.6, 'b')], 'em-6350', 6);
    expect(clear.leadNotices).toEqual([]);
    expect(clear.clearance.clearanceMm).toBeGreaterThanOrEqual(-ROUNDING_MM);
  });
});

// The audit's nesting scene: S sits in P's hole, 4 mm below the hole's top wall
// (scene Y), 10 mm from its sides and 20 mm from its bottom.
const PARENT: Part = {
  id: 'parent',
  layer: 'a',
  outer: rect(10, 10, 100, 100),
  holes: [rect(30, 30, 60, 60)],
};

function nestedChild(layer: string, topGapMm = 4): Part {
  return { id: 'child', layer, outer: rect(40, 30 + topGapMm, 40, 36) };
}

describe('CNC profile leads beside Inside path and On path neighbours', () => {
  it('lets a lead run into the waste slug of a hole another operation cuts', () => {
    // B is a hole cut Inside path: the material around it is the sheet A is
    // cut from, and only B's slug lies past its wall, so A keeps its lead.
    const source = project([PART_A, neighbourAbove(4, 'b')], 'em-3175', 3, {
      b: 'profile-inside',
    });
    const result = emitGcode(source);
    expect(result.gcode).toContain(A_LEAD_PLUNGE);
    expect(result.preflight.issues.filter((issue) => issue.code === LEAD_PLUNGE_CODE)).toEqual([]);
  });

  it('keeps the whole cutter out of a part cut On path', () => {
    const radius = EIGHTH_INCH_MM / 2;
    for (const [gap, led] of [
      [4, true],
      [2.5, false],
    ] as const) {
      const neighbour = neighbourAbove(gap, 'b');
      const source = project([PART_A, neighbour], 'em-3175', 3, { b: 'profile-on-path' });
      const result = emitGcode(source);
      // The On path cut already removes one radius inside B's line, so B keeps
      // only the material past that.
      const keptB = rect(30 + radius, 20 - gap - 10 + radius, 20 - 2 * radius, 10 - 2 * radius);
      const clearance = minimumCutterClearance(
        cuttingMoves(result.gcode),
        keptRegions(source, [PART_A, { ...neighbour, outer: keptB }]),
        radius,
      );
      const label = `gap ${gap}: ${clearance.region} ${clearance.line}`;
      expect(clearance.clearanceMm, label).toBeGreaterThanOrEqual(-ROUNDING_MM);
      expect(result.gcode.includes(A_LEAD_PLUNGE), label).toBe(led);
    }
  });
});

describe('CNC profile leads keep the cutter inside the hole around a nested part', () => {
  it('drops the lead that would cut the hole wall when both share one operation', () => {
    const run = emitted([PARENT, nestedChild('a')]);
    expect(run.clearance.clearanceMm, run.clearance.line).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(run.leadNotices).toHaveLength(1);
  });

  it('drops the same lead when the nested part is on its own operation', () => {
    const run = emitted([PARENT, nestedChild('b')]);
    expect(run.clearance.clearanceMm, run.clearance.line).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(run.leadNotices).toHaveLength(1);
    expect(run.leadNotices[0]?.message).toContain('Layer b:');
  });

  it('keeps the nested part’s lead where the hole leaves room for it', () => {
    const run = emitted([PARENT, nestedChild('a', 10)]);
    expect(run.clearance.clearanceMm).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(run.leadNotices).toEqual([]);
  });
});
