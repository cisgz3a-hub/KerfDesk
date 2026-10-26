// ADR-412 Amendment 2 (audit 2026-09-29 P2-relief-rough-3, meta v1 M7-P1-1):
// a relief is carved inside its own footprint. Roughing used to treat the
// map's outside as bottomless, so its outer ring rode the relief's last
// sample and a 1/4" end mill cut 2.175 mm into a relief 1 mm away, and
// 3.175 mm into bare stock round a lone relief. These cases compile scenes
// through emitGcode and judge the emitted program with an independent
// drop-cutter model: every feed move is walked in small steps, and wherever
// the bit stands below the stock top, the disk it cuts there must lie inside
// the footprint of the relief its axis stands over.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { toMachineCoords } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type Layer,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { detectCncReliefPlanningWarnings } from '../../ui/laser/cnc-relief-planning-warnings';
import { cuttingMoves, type CuttingMove } from './cnc-cutter-clearance.test-support';
import { emitGcode } from './emit-gcode';

const SIZE_MM = 24;
const DEPTH_MM = 3;
// The emitter rounds to 0.001 mm; a real overreach is millimetres.
const ROUNDING_MM = 0.005;
const WALK_STEP_MM = 0.02;
// Roughing cells are a 1/4" bit's diameter / 8; a 1/8" ball's finishing cells
// split its 0.025 mm-scallop row spacing in two (finishingCellSizeMm).
const ROUGH_CELL_MM = 6.35 / 8;
const FINISH_CELL_MM = Math.sqrt(0.025 * (3.175 - 0.025));
const COLORS = ['#a0522d', '#2d6aa0'] as const;

type Cutter = { readonly kind: 'end-mill' | 'ball-nose'; readonly radiusMm: number };
type Footprint = {
  readonly name: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

// A 24 x 24 mm relief: sample 0 is the 3 mm deep floor, 255 the stock top.
function relief(id: string, x: number, sample: number, color: string): ReliefObject {
  return {
    kind: 'relief',
    id,
    source: `${id}.png`,
    reliefSource: testReliefHeightfield({
      width: SIZE_MM,
      height: SIZE_MM,
      physicalWidthMm: SIZE_MM,
      physicalHeightMm: SIZE_MM,
      maxDepthMm: DEPTH_MM,
      samplesU8: new Array<number>(SIZE_MM * SIZE_MM).fill(sample),
    }),
    targetWidthMm: SIZE_MM,
    reliefDepthMm: DEPTH_MM,
    color,
    bounds: { minX: x, minY: 10, maxX: x + SIZE_MM, maxY: 10 + SIZE_MM },
    transform: { ...IDENTITY_TRANSFORM, x, y: 10 },
  };
}

function reliefLayer(id: string, color: string, settings: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id, name: id, color }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: 'em-6350',
      depthMm: DEPTH_MM,
      depthPerPassMm: 1.5,
      stepoverPercent: 40,
      tabsEnabled: false,
      ...settings,
    },
  };
}

function project(objects: ReadonlyArray<ReliefObject>, layers: ReadonlyArray<Layer>): Project {
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [...objects], layers: [...layers] },
  };
}

// The drawn footprint of a relief, in machine coordinates.
function footprint(source: Project, object: ReliefObject): Footprint {
  const corners = [
    { x: object.bounds.minX, y: object.bounds.minY },
    { x: object.bounds.maxX, y: object.bounds.maxY },
  ].map((point) => toMachineCoords(point, source.device));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    name: object.id,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// How far from its axis the bit cuts below the stock top with its tip at z.
function cutRadiusBelowTop(cutter: Cutter, z: number): number {
  if (cutter.kind === 'end-mill' || -z >= cutter.radiusMm) return cutter.radiusMm;
  return Math.sqrt(-z * (2 * cutter.radiusMm + z));
}

type CutterMoves = { readonly cutter: Cutter; readonly moves: ReadonlyArray<CuttingMove> };

// The bit each feed move cuts with: the job's first bit until a tool-change
// comment names the next one. Each later section opens with a rapid to where
// the program stands, so its first feed starts from the right place.
function movesByCutter(gcode: string, first: Cutter): ReadonlyArray<CutterMoves> {
  const sections: Array<{ cutter: Cutter; lines: string[] }> = [{ cutter: first, lines: [] }];
  let position = { x: 0, y: 0, z: 0 };
  for (const line of gcode.split(/\r?\n/)) {
    const change = /tool change: load ([\d.]+) mm .*?(ball|end mill)/i.exec(line);
    if (change !== null) {
      const kind = change[2]?.toLowerCase() === 'ball' ? 'ball-nose' : 'end-mill';
      sections.push({
        cutter: { kind, radiusMm: Number(change[1]) / 2 },
        lines: [`G0 X${position.x} Y${position.y} Z${position.z}`],
      });
    }
    sections[sections.length - 1]?.lines.push(line);
    position = positionAfter(line, position);
  }
  return sections.map((section) => ({
    cutter: section.cutter,
    moves: cuttingMoves(section.lines.join('\n')),
  }));
}

function positionAfter(line: string, position: { x: number; y: number; z: number }) {
  const code = line
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .toUpperCase();
  // G53 moves are machine-frame parks; G4 is a dwell.
  if (/\bG0*(53|4)\b/.test(code)) return position;
  const word = (axis: string): number | undefined => {
    const match = new RegExp(`${axis}(-?\\d*\\.?\\d+)`).exec(code);
    return match === null ? undefined : Number(match[1]);
  };
  return { x: word('X') ?? position.x, y: word('Y') ?? position.y, z: word('Z') ?? position.z };
}

type Overreach = { readonly overreachMm: number; readonly line: string; readonly z: number };

// The furthest any cut below the stock top reaches past the footprint its
// axis stands over (negative: it stays that far inside). An axis over no
// footprint counts as reaching its whole cut radius past one.
function worstOverreach(
  sections: ReadonlyArray<CutterMoves>,
  footprints: ReadonlyArray<Footprint>,
): Overreach {
  let worst: Overreach = { overreachMm: Number.NEGATIVE_INFINITY, line: '', z: 0 };
  for (const { cutter, moves } of sections) {
    for (const move of moves) {
      const length = Math.hypot(
        move.to.x - move.from.x,
        move.to.y - move.from.y,
        move.to.z - move.from.z,
      );
      const steps = Math.max(1, Math.ceil(length / WALK_STEP_MM));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = move.from.x + t * (move.to.x - move.from.x);
        const y = move.from.y + t * (move.to.y - move.from.y);
        const z = move.from.z + t * (move.to.z - move.from.z);
        if (z >= -1e-9) continue;
        const radius = cutRadiusBelowTop(cutter, z);
        const over = footprints.find(
          (f) => x >= f.minX && x <= f.maxX && y >= f.minY && y <= f.maxY,
        );
        const inside =
          over === undefined
            ? 0
            : Math.min(x - over.minX, over.maxX - x, y - over.minY, over.maxY - y);
        const overreachMm = radius - inside;
        if (overreachMm > worst.overreachMm) worst = { overreachMm, line: move.line, z };
      }
    }
  }
  return worst;
}

const END_MILL: Cutter = { kind: 'end-mill', radiusMm: 3.175 };

function run(objects: ReadonlyArray<ReliefObject>, layers: ReadonlyArray<Layer>) {
  const source = project(objects, layers);
  const result = emitGcode(source);
  const sections = movesByCutter(result.gcode, END_MILL);
  const footprints = objects.map((object) => footprint(source, object));
  const deepest = Math.min(
    ...sections.flatMap(({ moves }) => moves.flatMap((move) => [move.from.z, move.to.z])),
  );
  return {
    source,
    gcode: result.gcode,
    sections,
    overreach: worstOverreach(sections, footprints),
    deepest,
    // How close the deepest cuts come to the deep relief's own wall.
    wallGap: (deep: Footprint) => wallGap(sections, deep),
    footprints,
  };
}

// Smallest gap between the deep relief's wall and a cut that reaches its
// floor: the floor is still cleared up to the wall, not left standing.
function wallGap(sections: ReadonlyArray<CutterMoves>, deep: Footprint): number {
  let best = Number.POSITIVE_INFINITY;
  for (const { cutter, moves } of sections) {
    for (const move of moves) {
      for (const point of [move.from, move.to]) {
        if (point.z > -DEPTH_MM + 0.01) continue;
        const inside = Math.min(
          point.x - deep.minX,
          deep.maxX - point.x,
          point.y - deep.minY,
          deep.maxY - point.y,
        );
        best = Math.min(best, inside - cutRadiusBelowTop(cutter, point.z));
      }
    }
  }
  return best;
}

const DEEP_X = 100;
const BORDER_X = DEEP_X + SIZE_MM + 1;

describe('relief cuts stay inside their own footprint (M7-P1-1)', () => {
  it('two reliefs 1 mm apart on one layer: the deep one no longer cuts into the border', () => {
    const r = run(
      [relief('deep', DEEP_X, 0, COLORS[0]), relief('border', BORDER_X, 255, COLORS[0])],
      [reliefLayer('L1', COLORS[0], { finishAllowanceMm: 0 })],
    );
    expect(r.overreach.overreachMm, `${r.overreach.line} at Z${r.overreach.z}`).toBeLessThanOrEqual(
      ROUNDING_MM,
    );
    // Still roughed to the floor, and the floor's outer ring reaches its wall
    // within the contour clearance (sqrt(10)/4 cells) plus one cell of a
    // 1/4" bit's 0.794 mm roughing grid.
    expect(r.deepest).toBeCloseTo(-DEPTH_MM, 3);
    expect(r.wallGap(r.footprints[0] as Footprint)).toBeLessThan(
      ROUGH_CELL_MM * (1 + Math.sqrt(10) / 4),
    );
  });

  it('two reliefs 1 mm apart on two operations, with default settings and a ball finish', () => {
    const r = run(
      [relief('deep', DEEP_X, 0, COLORS[0]), relief('border', BORDER_X, 255, COLORS[1])],
      [
        reliefLayer('L1', COLORS[0], { reliefFinishToolId: 'bn-3175' }),
        reliefLayer('L2', COLORS[1], { reliefFinishToolId: 'bn-3175' }),
      ],
    );
    expect(r.sections.map((s) => s.cutter.kind)).toContain('ball-nose');
    expect(r.overreach.overreachMm, `${r.overreach.line} at Z${r.overreach.z}`).toBeLessThanOrEqual(
      ROUNDING_MM,
    );
    // The ball finishes the floor to the wall's foot: its own radius away, to
    // within one 0.281 mm finishing cell.
    expect(r.deepest).toBeCloseTo(-DEPTH_MM, 3);
    expect(r.wallGap(r.footprints[0] as Footprint)).toBeLessThan(FINISH_CELL_MM);
  });

  it('a lone relief: no cut reaches past its own edge into bare stock', () => {
    const r = run(
      [relief('deep', DEEP_X, 0, COLORS[0])],
      [reliefLayer('L1', COLORS[0], { finishAllowanceMm: 0, reliefFinishToolId: 'bn-3175' })],
    );
    expect(r.overreach.overreachMm, `${r.overreach.line} at Z${r.overreach.z}`).toBeLessThanOrEqual(
      ROUNDING_MM,
    );
  });

  it('reliefs side by side are not reported; overlapping ones are, by name', () => {
    const apart = project(
      [relief('deep', DEEP_X, 0, COLORS[0]), relief('border', BORDER_X, 255, COLORS[1])],
      [reliefLayer('L1', COLORS[0], {}), reliefLayer('L2', COLORS[1], {})],
    );
    expect(detectCncReliefPlanningWarnings(apart).filter((w) => w.includes('overlap'))).toEqual([]);
    const overlapping = project(
      [
        relief('deep', DEEP_X, 0, COLORS[0]),
        relief('border', DEEP_X + SIZE_MM - 2, 255, COLORS[1]),
      ],
      [reliefLayer('L1', COLORS[0], {}), reliefLayer('L2', COLORS[1], {})],
    );
    const overlaps = detectCncReliefPlanningWarnings(overlapping).filter((w) =>
      w.includes('overlap'),
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toContain('"deep.png" (layer "L1")');
    expect(overlaps[0]).toContain('"border.png" (layer "L2")');
  });

  it('judges overlap by the placed footprints: touching or rotated clear is not reported', () => {
    const layers = [reliefLayer('L1', COLORS[0], {}), reliefLayer('L2', COLORS[1], {})];
    const overlapNotes = (second: ReliefObject): ReadonlyArray<string> =>
      detectCncReliefPlanningWarnings(
        project([relief('deep', DEEP_X, 0, COLORS[0]), second], layers),
      ).filter((w) => w.includes('overlap'));
    expect(overlapNotes(relief('border', DEEP_X + SIZE_MM, 255, COLORS[1]))).toEqual([]);
    // Turned 45 degrees about its top corner at (130, 30), the second relief's
    // upper-left edge runs along x + y = 160, past the deep relief's corner at
    // (124, 34): their bounding boxes overlap, the footprints do not.
    const turned = (x: number, y: number): ReliefObject => ({
      ...relief('turned', x, 255, COLORS[1]),
      transform: { ...IDENTITY_TRANSFORM, x, y, rotationDeg: 45 },
    });
    expect(overlapNotes(turned(130, 30))).toEqual([]);
    expect(overlapNotes(turned(126, 30))).toHaveLength(1);
  });
});
