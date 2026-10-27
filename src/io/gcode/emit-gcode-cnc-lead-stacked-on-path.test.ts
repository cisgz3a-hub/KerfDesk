// ADR-250 Amendment 4 (rolling audit v3 G5-P1-1): an On path operation cuts
// every stacked copy of an outline (ADR-359 Amendment 3), but the kept-wall
// model filled that operation's outlines even-odd, so two copies cancelled and
// the part had no wall. Another operation's lead then plunged into it at every
// depth, and the warning one copy gives was gone. These compile scenes through
// emitGcode and judge the emitted program with the independent cutter-disk
// model, each bit's section of the program at that bit's own radius.

import { describe, expect, it } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
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
  type CutterClearance,
  type KeptRegion,
} from './cnc-cutter-clearance.test-support';
import { emitGcode } from './emit-gcode';

const EIGHTH_INCH_MM = 3.175;
const QUARTER_INCH_MM = 6.35;
type Bit = 'em-3175' | 'em-6350';
const LEAD_PLUNGE_CODE = 'cnc-profile-lead-plunge';
const KEPT_PART_CODE = 'cnc-profile-cuts-kept-part';
// The emitter and the kerf offset round to 0.001 mm, so a contour that rides
// its own wall measures about -0.0005 mm. A gouge is far larger.
const ROUNDING_MM = 0.005;
// A's climb start, and so its 1/8" arc lead, sits mid-way along the edge that
// faces B (emit-gcode-cnc-lead-kept-parts.test.ts).
const A_LEAD_PLUNGE = 'G0 X38.413 Y383.175';

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

const PART_A = rect(20, 20, 40, 30);

/** B, 20 x 10 mm, `gapMm` above A's edge. */
function partB(gapMm: number): Polyline {
  return rect(30, 20 - gapMm - 10, 20, 10);
}

/** The same ring run the other way round, starting at another vertex. */
function reversed(ring: Polyline): Polyline {
  const points = [...ring.points].reverse();
  return { closed: true, points: [...points.slice(2), ...points.slice(0, 2)] };
}

function artwork(id: string, color: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [...polylines] }],
  };
}

function layer(id: 'a' | 'b', color: string, cutType: CncCutType, toolId: Bit): Layer {
  return {
    ...createLayer({ id, color }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType,
      toolId,
      depthMm: 3,
      depthPerPassMm: 1.5,
      tabsEnabled: false,
    },
  };
}

type Layout = {
  readonly gapMm: number;
  /** B's objects, each a list of polylines: Duplicate without moving adds an object. */
  readonly b: ReadonlyArray<ReadonlyArray<Polyline>>;
  readonly bitA?: Bit;
  readonly bitB?: Bit;
};

function project(layout: Layout): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [
        artwork('part-a', '#ff0000', [PART_A]),
        ...layout.b.map((polylines, index) => artwork(`part-b-${index}`, '#0000ff', polylines)),
      ],
      layers: [
        layer('a', '#ff0000', 'profile-outside', layout.bitA ?? 'em-3175'),
        layer('b', '#0000ff', 'profile-on-path', layout.bitB ?? 'em-3175'),
      ],
    },
  };
}

function radiusOf(bit: Bit): number {
  return (bit === 'em-6350' ? QUARTER_INCH_MM : EIGHTH_INCH_MM) / 2;
}

function bitNamed(line: string): Bit {
  return line.includes('6.35') ? 'em-6350' : 'em-3175';
}

/** The program bit by bit: a multi-tool header names the first bit and each
 * M0 block the next. A one-bit program is one section cut with `onlyBit`. */
function bitSections(gcode: string, onlyBit: Bit): ReadonlyArray<{ bit: Bit; gcode: string }> {
  const sections: { bit: Bit; lines: string[] }[] = [{ bit: onlyBit, lines: [] }];
  for (const line of gcode.split(/\r?\n/)) {
    const first = sections[0];
    if (sections.length === 1 && first !== undefined && line.startsWith('; tool: ')) {
      first.bit = bitNamed(line);
    }
    if (line.startsWith(TOOL_CHANGE_LOAD_PREFIX)) sections.push({ bit: bitNamed(line), lines: [] });
    sections.at(-1)?.lines.push(line);
  }
  return sections.map(({ bit, lines }) => ({ bit, gcode: lines.join('\n') }));
}

function emitted(layout: Layout) {
  const source = project(layout);
  const result = emitGcode(source);
  const machine = (points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> =>
    points.map((point) => toMachineCoords(point, source.device));
  // B's own On path cut removes one radius of its bit inside its line, so B
  // keeps only the material past that.
  const rB = radiusOf(layout.bitB ?? 'em-3175');
  const b = partB(layout.gapMm).points[0] as Vec2;
  const keptB = rect(b.x + rB, b.y + rB, 20 - 2 * rB, 10 - 2 * rB);
  const regions: ReadonlyArray<KeptRegion> = [
    { name: 'part-a', outer: machine(PART_A.points) },
    { name: 'part-b', outer: machine(keptB.points) },
  ];
  const clearances = bitSections(result.gcode, layout.bitA ?? 'em-3175').map(({ bit, gcode }) =>
    minimumCutterClearance(cuttingMoves(gcode), regions, radiusOf(bit)),
  );
  const worst = clearances.reduce<CutterClearance>(
    (low, next) => (next.clearanceMm < low.clearanceMm ? next : low),
    { clearanceMm: Infinity, region: '', line: '' },
  );
  const issues = result.preflight.issues.map((issue) => `${issue.code}: ${issue.message}`);
  return { gcode: result.gcode, clearance: worst, issues };
}

function codes(issues: ReadonlyArray<string>, code: string): ReadonlyArray<string> {
  return issues.filter((issue) => issue.startsWith(`${code}: `));
}

describe('ADR-250 Amendment 4: an On path part keeps its wall when it is stacked', () => {
  it('drops the 1/8" lead beside two copies at 2.5 mm and 3 mm, as for one copy', () => {
    for (const gapMm of [2.5, 3]) {
      const one = emitted({ gapMm, b: [[partB(gapMm)]] });
      const two = emitted({ gapMm, b: [[partB(gapMm)], [partB(gapMm)]] });
      const label = `gap ${gapMm}: ${two.clearance.region} ${two.clearance.line}`;
      expect(one.gcode).not.toContain(A_LEAD_PLUNGE);
      expect(codes(one.issues, LEAD_PLUNGE_CODE)).toHaveLength(1);
      // The independent model: the cutter stays out of B's kept material.
      expect(two.clearance.clearanceMm, label).toBeGreaterThanOrEqual(-ROUNDING_MM);
      expect(two.gcode, label).not.toContain(A_LEAD_PLUNGE);
      expect(two.issues, label).toEqual(one.issues);
    }
  });

  it('treats a reversed copy, a doubled path and three copies as one wall', () => {
    const gapMm = 2.5;
    const ring = partB(gapMm);
    const one = emitted({ gapMm, b: [[ring]] });
    const layouts: ReadonlyArray<[string, Layout['b']]> = [
      ['reversed copy', [[ring], [reversed(ring)]]],
      ['one path listing the ring twice', [[ring, ring]]],
      ['three copies', [[ring], [ring], [reversed(ring)]]],
    ];
    for (const [name, b] of layouts) {
      const run = emitted({ gapMm, b });
      const label = `${name}: ${run.clearance.region} ${run.clearance.line}`;
      expect(run.clearance.clearanceMm, label).toBeGreaterThanOrEqual(-ROUNDING_MM);
      expect(run.gcode, label).not.toContain(A_LEAD_PLUNGE);
      expect(run.issues, label).toEqual(one.issues);
    }
  });

  it('still cuts every copy On path, as ADR-359 Amendment 3 keeps them', () => {
    const gapMm = 2.5;
    const plunges = (gcode: string) =>
      gcode.split('\n').filter((line) => /^G1 Z-3\.000(\s|$)/.test(line));
    const one = emitted({ gapMm, b: [[partB(gapMm)]] });
    const two = emitted({ gapMm, b: [[partB(gapMm)], [partB(gapMm)]] });
    // A's profile and B's ring cut once each at full depth; the copy once more.
    expect(plunges(two.gcode).length).toBe(plunges(one.gcode).length + 1);
  });

  it('drops a 1/4" lead beside two copies of a 1/8" On path part at 5 mm', () => {
    const layout = { gapMm: 5, bitA: 'em-6350', bitB: 'em-3175' } as const;
    const one = emitted({ ...layout, b: [[partB(5)]] });
    const two = emitted({ ...layout, b: [[partB(5)], [partB(5)]] });
    expect(codes(one.issues, LEAD_PLUNGE_CODE)).toHaveLength(1);
    expect(two.clearance.clearanceMm, two.clearance.line).toBeGreaterThanOrEqual(-ROUNDING_MM);
    expect(two.issues).toEqual(one.issues);
  });

  it('names a 1/4" profile that reaches into two copies at 4 mm, as for one copy', () => {
    const layout = { gapMm: 4, bitA: 'em-6350', bitB: 'em-3175' } as const;
    const one = emitted({ ...layout, b: [[partB(4)]] });
    const two = emitted({ ...layout, b: [[partB(4)], [partB(4)]] });
    // A's profile itself reaches 3.175 - 1.5875 - (4 - 3.175) = 0.7625 mm into
    // what B keeps: no lead causes it, and Job Review must say so.
    expect(two.clearance.clearanceMm).toBeCloseTo(-0.7625, 2);
    expect(two.clearance.region).toBe('part-b');
    const named = codes(two.issues, KEPT_PART_CODE);
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/keeps and cuts up to 0\.7[56] mm into it/);
    expect(two.issues).toEqual(one.issues);
  });
});
