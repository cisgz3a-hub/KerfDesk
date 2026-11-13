// CNC audit v3 N3-P1-1 (ADR-106 Amendment 3): a pocket cut to the stock
// bottom freed every island in it (a frame's centre, the counter of an "O")
// and Job Review said nothing, while the same loops as an Inside profile with
// tabs off warned. Each case first measures the emitted program: it is carved
// into an independent height field, and a flood fill over the stock the
// program leaves at the bottom says whether the island is still attached. The
// warning must agree with that measurement.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import {
  carveMove,
  createHeightField,
  parseProgramMoves,
  type HeightField,
} from '../../core/cnc/program-height-field.test-support';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../../core/devices';
import { cncGrblStrategy } from '../../core/output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncLayerSettings,
  type Polyline,
  type Project,
  type Vec2,
} from '../../core/scene';
import { detectCncThroughCutTabWarnings } from './cnc-through-cut-tab-warnings';

const STOCK_MM = 6.35;
const TOOL_ID = 'em-6350';
const RADIUS_MM = 6.35 / 2;
const CELL_MM = 0.25;

function rect(x: number, y: number, width: number, height: number, reverse = false): Polyline {
  const points = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  return { closed: true, points: reverse ? points.reverse() : points };
}

function project(contours: ReadonlyArray<Polyline>, cnc: Partial<CncLayerSettings>): Project {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    name: 'Pocket',
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket' as const,
      toolId: TOOL_ID,
      depthPerPassMm: 2,
      ...cnc,
    },
  };
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: STOCK_MM },
    },
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: 'plaque',
          source: 'plaque.svg',
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#ff0000', polylines: [...contours] }],
        },
      ],
      layers: [layer],
    },
  };
}

function machine(point: Vec2): Vec2 {
  return toMachineCoords(point, DEFAULT_DEVICE_PROFILE);
}

function carved(target: Project, contours: ReadonlyArray<Polyline>): HeightField {
  if (target.machine?.kind !== 'cnc') throw new Error('CNC project expected');
  const job = compileCncJob(target.scene, target.device, target.machine);
  const moves = parseProgramMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
  const field = createHeightField(
    contours.map((contour) => contour.points.map(machine)),
    CELL_MM,
  );
  for (const move of moves) if (!move.rapid) carveMove(field, move, RADIUS_MM);
  return field;
}

/**
 * Whether the stock at `point` is still joined to the field's border by
 * material the program leaves at the stock bottom. A cell cut to within
 * `skinMm` of the bottom counts as gone: a thinner skin tears.
 */
function attached(field: HeightField, point: Vec2, skinMm = 0): boolean {
  const bottom = -STOCK_MM + skinMm + 1e-6;
  const solid = (index: number): boolean => (field.z[index] ?? 0) > bottom;
  const seen = new Uint8Array(field.width * field.height);
  // The field's first row lies outside the pocket: uncut stock.
  const queue = Array.from({ length: field.width }, (_, col) => col);
  for (const index of queue) seen[index] = 1;
  const at = machine(point);
  const target =
    Math.floor((at.y - field.minY) / field.cellMm) * field.width +
    Math.floor((at.x - field.minX) / field.cellMm);
  if (!solid(target)) throw new Error('probe point is not stock');
  while (queue.length > 0) {
    const index = queue.pop() as number;
    if (index === target) return true;
    for (const next of neighbours(field, index)) {
      if (seen[next] === 1 || !solid(next)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

function neighbours(field: HeightField, index: number): number[] {
  const col = index % field.width;
  const row = Math.floor(index / field.width);
  const out: number[] = [];
  if (col > 0) out.push(index - 1);
  if (col + 1 < field.width) out.push(index + 1);
  if (row > 0) out.push(index - field.width);
  if (row + 1 < field.height) out.push(index + field.width);
  return out;
}

const FRAME = [rect(20, 20, 60, 40), rect(45, 35, 10, 10, true)];
const ISLAND_CENTRE = { x: 50, y: 40 };

describe('a pocket cut to the stock bottom round an island (ADR-106 Amendment 3)', () => {
  it('names the island the emitted program cuts free', () => {
    const target = project(FRAME, { depthMm: STOCK_MM });
    expect(attached(carved(target, FRAME), ISLAND_CENTRE)).toBe(false);
    const warnings = detectCncThroughCutTabWarnings(target);
    expect(warnings).toEqual([expect.stringContaining('pockets through the stock')]);
    expect(warnings[0]).toContain('a 10 × 10 mm island');
    expect(warnings[0]).toContain('Pockets take no holding tabs');
    expect(warnings[0]).toContain('set Cut depth to 5.85 mm');
  });

  it('names it for raster and adaptive pockets too', () => {
    for (const pocketStrategy of ['raster-x', 'adaptive'] as const) {
      const target = project(FRAME, { depthMm: STOCK_MM, pocketStrategy });
      expect(attached(carved(target, FRAME), ISLAND_CENTRE)).toBe(false);
      expect(detectCncThroughCutTabWarnings(target)[0]).toContain('a 10 × 10 mm island');
    }
  });

  it('names the island in place of the spoilboard line when the pocket cuts past the bottom', () => {
    const warnings = detectCncThroughCutTabWarnings(project(FRAME, { depthMm: 7 }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('0.65 mm into the spoilboard');
    expect(warnings[0]).toContain('a 10 × 10 mm island');
  });

  it('says a floor thinner than 0.2 mm holds the island only by a skin', () => {
    const target = project(FRAME, { depthMm: 6.3 });
    expect(attached(carved(target, FRAME), ISLAND_CENTRE, 0.2)).toBe(false);
    expect(detectCncThroughCutTabWarnings(target)).toEqual([
      expect.stringContaining('leaves only 0.05 mm of stock under its pocket floor'),
    ]);
  });

  it('counts each island of a frame with two', () => {
    const two = [rect(0, 0, 80, 40), rect(10, 10, 15, 15, true), rect(50, 12, 20, 10, true)];
    const warnings = detectCncThroughCutTabWarnings(project(two, { depthMm: STOCK_MM }));
    expect(warnings[0]).toContain('2 islands (15 × 15 mm and 20 × 10 mm)');
    expect(warnings[0]).toContain('they come free');
  });

  it('is silent when the holding floor it offers is left', () => {
    const target = project(FRAME, { depthMm: STOCK_MM - 0.5 });
    expect(attached(carved(target, FRAME), ISLAND_CENTRE, 0.2)).toBe(true);
    expect(detectCncThroughCutTabWarnings(target)).toEqual([]);
  });

  it('is silent for an island the bit cannot get all the way round', () => {
    // 5 mm from the left wall, narrower than the 6.35 mm bit: the ring cannot
    // pass, so the island stays joined to the wall.
    const tight = [rect(20, 20, 60, 40), rect(25, 35, 10, 10, true)];
    const target = project(tight, { depthMm: STOCK_MM });
    expect(attached(carved(target, tight), { x: 30, y: 40 })).toBe(true);
    expect(detectCncThroughCutTabWarnings(target)).toEqual([]);
  });

  it('is silent for a through pocket with no island', () => {
    expect(
      detectCncThroughCutTabWarnings(project([rect(20, 20, 60, 40)], { depthMm: STOCK_MM })),
    ).toEqual([]);
  });
});
