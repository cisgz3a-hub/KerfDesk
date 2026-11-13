// CNC audit v3 N3r-P2-1 (ADR-286 Amendment 1): a pocket on script text left
// every join between overlapping letters standing as a full-height island
// (Pacifico "Hello": 18.7 mm²), because only V-carve and the tapered inlay
// resolved a text object's own glyphs non-zero. Two 10 mm boxes overlapping
// by 4 mm stand in for a join, as in compile-cnc-vcarve-text.test.ts: read
// even-odd they are two 6 mm rectangles with a 4 mm bar left between them.
//
// The oracle is the emitted program carved into an independent height field
// (program-height-field.test-support.ts), not the planner's own region.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncCutType,
  type ImportedSvg,
  type Polyline,
  type Scene,
  type SceneObject,
  type TextObject,
  type Vec2,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import {
  carveMove,
  createHeightField,
  parseProgramMoves,
  type HeightField,
} from './program-height-field.test-support';

const AT = 50;
const SIZE = 10;
const OVERLAP_START = 56;
const DEPTH_MM = 2;
const RADIUS_MM = 3.175 / 2;
const BAR_MARGIN_MM = 0.5;

function box(atX: number, atY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: atX, y: atY },
      { x: atX + size, y: atY },
      { x: atX + size, y: atY + size },
      { x: atX, y: atY + size },
    ],
  };
}

const GLYPHS = [box(AT, AT, SIZE), box(OVERLAP_START, AT, SIZE)];
const BOUNDS = { minX: AT, minY: AT, maxX: OVERLAP_START + SIZE, maxY: AT + SIZE };

function textObject(): TextObject {
  return {
    kind: 'text',
    id: 'T1',
    content: 'll',
    fontKey: 'pacifico-regular',
    sizeMm: SIZE,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#ff0000',
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: GLYPHS }],
  };
}

function svgObject(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'S1',
    source: 'S1.svg',
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: GLYPHS }],
  };
}

function scene(object: SceneObject, cutType: CncCutType, strategy?: 'raster-x'): Scene {
  return {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType,
          ...(strategy === undefined ? {} : { pocketStrategy: strategy }),
          depthMm: DEPTH_MM,
          depthPerPassMm: DEPTH_MM,
        },
      },
    ],
  };
}

function machine(point: Vec2): Vec2 {
  return toMachineCoords(point, DEFAULT_DEVICE_PROFILE);
}

function carved(target: Scene): HeightField {
  const job = compileCncJob(target, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const moves = parseProgramMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
  const walls = GLYPHS.map((glyph) => glyph.points.map(machine));
  const field = createHeightField(walls, 0.1);
  for (const move of moves) if (!move.rapid) carveMove(field, move, RADIUS_MM);
  return field;
}

/** Fraction of the join bar cut to the pocket floor by the emitted program. */
function joinCutFraction(target: Scene): number {
  const field = carved(target);
  const a = machine({ x: OVERLAP_START + BAR_MARGIN_MM, y: AT + BAR_MARGIN_MM });
  const b = machine({ x: AT + SIZE - BAR_MARGIN_MM, y: AT + SIZE - BAR_MARGIN_MM });
  let inBar = 0;
  let cut = 0;
  for (let row = 0; row < field.height; row += 1)
    for (let col = 0; col < field.width; col += 1) {
      const x = field.minX + (col + 0.5) * field.cellMm;
      const y = field.minY + (row + 0.5) * field.cellMm;
      if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue;
      if (y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
      inBar += 1;
      if ((field.z[row * field.width + col] ?? 0) <= -DEPTH_MM + 0.01) cut += 1;
    }
  if (inBar === 0) throw new Error('join bar fell outside the height field');
  return cut / inBar;
}

describe('a pocket on text whose glyphs overlap (ADR-286 Amendment 1)', () => {
  it('cuts the join to the floor with offset rings', () => {
    expect(joinCutFraction(scene(textObject(), 'pocket'))).toBeGreaterThan(0.99);
  });

  it('cuts the join to the floor with raster rows', () => {
    expect(joinCutFraction(scene(textObject(), 'pocket', 'raster-x'))).toBeGreaterThan(0.99);
  });

  it('cuts the join in a straight inlay pair pocket too', () => {
    expect(joinCutFraction(scene(textObject(), 'inlay-pair'))).toBeGreaterThan(0.99);
  });

  it('still knocks the overlap out for a non-text object, which may mean even-odd', () => {
    expect(joinCutFraction(scene(svgObject(), 'pocket'))).toBeLessThan(0.01);
  });
});
