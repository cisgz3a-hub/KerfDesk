// ADR-433 Amendment 3 (meta audit v1 M6-P2-3): parts on two CNC profile
// operations placed closer than the bit are cut into, and the narrow-gap check
// ran per operation, so only the one-operation layout warned. These compile
// scenes through emitGcode, judge the emitted program with the independent
// cutter-disk model, and check that Job Review's line names the same reach.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { toMachineCoords } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncCutType,
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

const RADIUS_MM = 3.175 / 2;
const CODE = 'cnc-profile-cuts-kept-part';
// The offset and the emitter round to 0.001 mm.
const ROUNDING_MM = 0.005;

type Part = {
  readonly id: string;
  readonly layer: 'a' | 'b';
  readonly outer: Polyline;
  readonly holes?: ReadonlyArray<Polyline>;
};

const COLORS = { a: '#ff0000', b: '#0000ff' } as const;

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
    paths: [{ color: COLORS[part.layer], polylines: [part.outer, ...(part.holes ?? [])] }],
  };
}

function layer(id: 'a' | 'b', cutType: CncCutType, finishAllowanceMm = 0): Layer {
  return {
    ...createLayer({ id, color: COLORS[id] }),
    name: id === 'a' ? 'Plates' : 'Brackets',
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType,
      toolId: 'em-3175',
      depthMm: 3,
      depthPerPassMm: 1.5,
      tabsEnabled: false,
      ...(finishAllowanceMm > 0 ? { finishAllowanceMm } : {}),
    },
  };
}

function project(
  parts: ReadonlyArray<Part>,
  cutB: CncCutType = 'profile-outside',
  finishAllowanceMm = 0,
): Project {
  const ids = [...new Set(parts.map((part) => part.layer))];
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: parts.map(partObject),
      layers: ids.map((id) => layer(id, id === 'b' ? cutB : 'profile-outside', finishAllowanceMm)),
    },
  };
}

function regions(source: Project, parts: ReadonlyArray<Part>): ReadonlyArray<KeptRegion> {
  const machine = (polyline: Polyline): ReadonlyArray<Vec2> =>
    polyline.points.map((point) => toMachineCoords(point, source.device));
  return parts.map((part) => ({
    name: part.id,
    outer: machine(part.outer),
    holes: (part.holes ?? []).map(machine),
  }));
}

function emitted(parts: ReadonlyArray<Part>, finishAllowanceMm = 0) {
  const source = project(parts, 'profile-outside', finishAllowanceMm);
  const result = emitGcode(source);
  const clearance = minimumCutterClearance(
    cuttingMoves(result.gcode),
    regions(source, parts),
    RADIUS_MM,
  );
  const job = compileCncJob(source.scene, source.device, DEFAULT_CNC_MACHINE_CONFIG);
  const cuts = job.cncCompilation?.keptPartCuts ?? [];
  const warnings = result.preflight.issues.filter((issue) => issue.code === CODE);
  return { clearance, cuts, warnings };
}

const PLATE: Part = { id: 'plate', layer: 'a', outer: rect(20, 20, 40, 30) };

function bracketBelow(gapMm: number, onLayer: 'a' | 'b' = 'b'): Part {
  return { id: 'bracket', layer: onLayer, outer: rect(30, 50 + gapMm, 20, 10) };
}

describe('CNC profile cuts that reach a part another operation keeps', () => {
  it('reproduces the audit scene: two operations, parts 2.5 mm apart, 1/8" bit', () => {
    const run = emitted([PLATE, bracketBelow(2.5)]);
    // The independent model sees the gouge the audit measured.
    expect(run.clearance.clearanceMm).toBeCloseTo(-(3.175 - 2.5), 2);
    expect(run.cuts.map((cut) => [cut.layerId, cut.keptLayerId])).toEqual([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    for (const cut of run.cuts) {
      expect(cut.depthMm).not.toBeNull();
      expect(Math.abs((cut.depthMm ?? 0) + run.clearance.clearanceMm)).toBeLessThan(0.01);
      expect(cut.contours).toBe(1);
    }
    expect(run.warnings).toHaveLength(2);
    // 3.175 and 0.675 print as 3.17 and 0.67, as ADR-433's lines print the bit.
    expect(run.warnings[0]?.message).toMatch(
      /^Layer "Plates": its 3\.17 mm cut reaches 1 part that layer "Brackets" keeps and cuts up to 0\.6[78] mm into it at X [\d.]+ · Y [\d.]+ mm\. The parts sit closer together than the bit can pass between\. Move them further apart\.$/,
    );
  });

  it('warns at every gap narrower than the cut and at none wider', () => {
    for (const gap of [1.6, 2, 3, 3.1]) {
      const run = emitted([PLATE, bracketBelow(gap)]);
      expect(run.clearance.clearanceMm, `gap ${gap}`).toBeLessThan(-ROUNDING_MM);
      expect(run.warnings, `gap ${gap}`).toHaveLength(2);
      const deepest = Math.max(...run.cuts.map((cut) => cut.depthMm ?? Infinity));
      expect(deepest, `gap ${gap}`).toBeCloseTo(-run.clearance.clearanceMm, 2);
    }
    // Closer than the cutter radius, each toolpath runs through the other part.
    for (const gap of [0.5, 1]) {
      const run = emitted([PLATE, bracketBelow(gap)]);
      expect(run.clearance.clearanceMm, `gap ${gap}`).toBeLessThanOrEqual(-RADIUS_MM);
      expect(
        run.cuts.map((cut) => cut.depthMm),
        `gap ${gap}`,
      ).toEqual([null, null]);
      expect(run.warnings[0]?.message).toContain('cut runs into 1 part that layer "Brackets"');
    }
    for (const gap of [3.25, 4, 8]) {
      const run = emitted([PLATE, bracketBelow(gap)]);
      expect(run.clearance.clearanceMm, `gap ${gap}`).toBeGreaterThanOrEqual(-ROUNDING_MM);
      expect(run.cuts, `gap ${gap}`).toEqual([]);
    }
  });

  // One operation offsets both outlines together, so the gap stays uncut and
  // ADR-433's gap line says so; nothing is cut into.
  it('leaves the one-operation layout to the narrow-gap check', () => {
    const run = emitted([PLATE, bracketBelow(2.5, 'a')]);
    expect(run.clearance.clearanceMm).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(run.cuts).toEqual([]);
  });

  it('checks a part nested in another operation’s hole against the hole wall only', () => {
    const parent: Part = {
      id: 'parent',
      layer: 'a',
      outer: rect(10, 10, 100, 100),
      holes: [rect(30, 30, 60, 60)],
    };
    // 2 mm below the hole's top wall, 8 mm or more from its other walls.
    const child: Part = { id: 'child', layer: 'b', outer: rect(40, 32, 40, 36) };
    const run = emitted([parent, child]);
    expect(run.clearance.clearanceMm).toBeCloseTo(-(3.175 - 2), 2);
    const childCut = run.cuts.find((cut) => cut.layerId === 'b');
    // The parent's outer boundary encloses the child's cut and is not a wall it meets.
    expect(childCut?.contours).toBe(1);
    expect(childCut?.depthMm).toBeCloseTo(3.175 - 2, 2);
    expect(run.cuts.find((cut) => cut.layerId === 'a')?.depthMm).toBeCloseTo(3.175 - 2, 2);
  });

  it('gives no position when the program runs away from where it was compiled', () => {
    const source = project([PLATE, bracketBelow(2.5)]);
    const result = emitGcode(source, { preflightCoordinateMode: 'relative-origin' });
    const warning = result.preflight.issues.find((issue) => issue.code === CODE);
    expect(warning?.message).toMatch(/cuts up to 0\.6[78] mm into it\. The parts/);
    expect(warning?.message).not.toContain(' at X ');
  });
});

// ADR-433 Amendment 5 (rolling audit v3 G5-P3-1): a finish allowance roughs
// the allowance further out than the finished wall, so it can reach a part the
// bit passes clear of. The line named the spacing as the cause.
describe('a finish allowance whose roughing reaches another operation’s part', () => {
  it('names the allowance and an allowance that clears, when only roughing reaches', () => {
    // 3.6 mm apart the 3.175 mm bit passes with 0.425 mm to spare, but a
    // 0.5 mm allowance roughs 2.0875 mm off each part: 0.075 mm into the other.
    const parts = [PLATE, bracketBelow(3.6)];
    const run = emitted(parts, 0.5);
    expect(run.clearance.clearanceMm).toBeCloseTo(-0.075, 2);
    expect(run.warnings).toHaveLength(2);
    for (const warning of run.warnings) {
      expect(warning.message).toContain(
        'Its 0.5 mm finish allowance moves the roughing pass out into it. ' +
          'An allowance of 0.42 mm or less clears it, or move the parts apart.',
      );
      expect(warning.message).not.toContain('closer together than the bit');
    }
    // The independent model agrees that the allowance it names clears.
    const reduced = emitted(parts, 0.42);
    expect(reduced.clearance.clearanceMm).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(reduced.warnings).toEqual([]);
    expect(emitted(parts).warnings).toEqual([]);
  });

  it('keeps the spacing line where the finishing pass reaches the part too', () => {
    const run = emitted([PLATE, bracketBelow(2.5)], 0.5);
    expect(run.warnings).toHaveLength(2);
    for (const warning of run.warnings) {
      expect(warning.message).toContain('closer together than the bit can pass between');
    }
  });
});
