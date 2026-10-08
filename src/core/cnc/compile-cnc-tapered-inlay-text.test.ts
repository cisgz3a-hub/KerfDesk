import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type ImportedSvg,
  type Polyline,
  type Scene,
  type SceneObject,
  type TextObject,
  type Vec2,
} from '../scene';
import { DEFAULT_CNC_TAPERED_INLAY } from '../scene/cnc-tapered-inlay';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { collectLayerPolylines, compileCncJob } from './compile-cnc-job';

const TOOL: CncTool = {
  id: 'v60',
  name: 'Pointed V60',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 60,
};
const CONFIG = { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: TOOL.id, tools: [TOOL] };
const INTENT = {
  ...DEFAULT_CNC_TAPERED_INLAY,
  pocketDepthMm: 0.7,
  engagementDepthMm: 0.5,
  glueGapMm: 0.2,
  surfaceClearanceMm: 0.3,
  plugBorderMm: 1,
};
function box(x: number, y = 10, width = 6): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + width },
      { x, y: y + width },
    ],
  };
}
function text(id: string, polylines: ReadonlyArray<Polyline>): TextObject {
  return {
    kind: 'text',
    id,
    content: 'ab',
    fontKey: 'pacifico-regular',
    sizeMm: 6,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 16 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
  };
}
function vector(fillRule?: 'nonzero' | 'evenodd'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'converted',
    source: 'converted.svg',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 16 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [box(10), box(14)],
        ...(fillRule === undefined ? {} : { fillRule }),
      },
    ],
  };
}
function sourceScene(objects: ReadonlyArray<SceneObject>): Scene {
  return {
    objects,
    layers: [
      {
        ...createLayer({ id: 'pair', color: '#000000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'inlay-pair',
          toolId: TOOL.id,
          depthPerPassMm: 0.25,
          vResolutionMm: 0.1,
          taperedInlay: INTENT,
        },
      },
    ],
  };
}
type Point3 = Vec2 & { readonly z: number };
type Move = { readonly from: Point3; readonly to: Point3 };

// Read the emitted absolute G1 words independently of the preview/simulator.
function cuttingMoves(program: string): ReadonlyArray<Move> {
  const moves: Move[] = [];
  let position: Point3 = { x: 0, y: 0, z: 0 };
  let motion = 0;
  for (const line of program.split(/\r?\n/)) {
    const code = line.replace(/;.*/, '');
    const words = [...code.matchAll(/([A-Z])([+-]?(?:\d+\.?\d*|\.\d+))/g)];
    const next = { ...position };
    let moved = false;
    for (const word of words) {
      const letter = word[1];
      const value = Number(word[2]);
      if (letter === 'G' && (value === 0 || value === 1)) motion = value;
      if (letter === 'X' || letter === 'Y' || letter === 'Z') {
        next[letter.toLowerCase() as 'x' | 'y' | 'z'] = value;
        moved = true;
      }
    }
    if (!moved) continue;
    if (motion === 1) moves.push({ from: position, to: next });
    position = next;
  }
  return moves;
}

// At a fixed stock Z the pointed bit's swept section has linearly varying radius.
// Minimise its squared radial clearance along each actual linear move.
function cutsAt(point: Vec2, z: number, move: Move): boolean {
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;
  const dz = move.to.z - move.from.z;
  let lo = 0;
  let hi = 1;
  if (dz === 0) {
    if (move.from.z > z) return false;
  } else {
    const crossing = (z - move.from.z) / dz;
    if (dz > 0) hi = Math.min(hi, crossing);
    else lo = Math.max(lo, crossing);
  }
  if (lo > hi || hi < 0 || lo > 1) return false;
  lo = Math.max(0, lo);
  hi = Math.min(1, hi);
  const slope = Math.tan(Math.PI / 6);
  const px = point.x - move.from.x;
  const py = point.y - move.from.y;
  const radius = (z - move.from.z) * slope;
  const dr = -dz * slope;
  const a = dx * dx + dy * dy - dr * dr;
  const b = -2 * (px * dx + py * dy + radius * dr);
  const clearance = (t: number) => (px - t * dx) ** 2 + (py - t * dy) ** 2 - (radius + t * dr) ** 2;
  const values = [clearance(lo), clearance(hi)];
  if (a > 0) values.push(clearance(Math.min(hi, Math.max(lo, -b / (2 * a)))));
  return Math.min(...values) <= 1e-10;
}
function pocketMoves(scene: Scene): ReadonlyArray<Move> {
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, CONFIG);
  const pocket = job.groups.find(
    (group) => group.kind === 'cnc' && group.pairedInlay?.piece === 'pocket',
  );
  if (pocket === undefined) throw new Error('Missing female inlay output');
  return cuttingMoves(cncGrblStrategy.emit({ groups: [pocket] }, DEFAULT_DEVICE_PROFILE));
}
function joinFraction(scene: Scene): number {
  const moves = pocketMoves(scene);
  let total = 0;
  let carved = 0;
  for (let x = 14.4; x < 15.7; x += 0.2) {
    for (let y = 10.5; y < 15.6; y += 0.2) {
      total++;
      const point = toMachineCoords({ x, y }, DEFAULT_DEVICE_PROFILE);
      if (moves.some((move) => cutsAt(point, -0.1, move))) carved++;
    }
  }
  return carved / total;
}
function signedArea(contours: ReadonlyArray<Polyline>): number {
  let twiceArea = 0;
  for (const contour of contours) {
    for (const [index, point] of contour.points.entries()) {
      const next = contour.points[(index + 1) % contour.points.length];
      if (next !== undefined) twiceArea += point.x * next.y - next.x * point.y;
    }
  }
  return Math.abs(twiceArea / 2);
}

describe('tapered inlay source winding', () => {
  it.each([
    ['text', [text('word', [box(10), box(14)])]],
    ['converted nonzero text', [vector('nonzero')]],
  ] as const)(
    'compiles and cuts overlapping glyph joins for %s without changing source',
    (_, objects) => {
      const scene = sourceScene(objects);
      const before = JSON.stringify(scene);
      const operation = scene.layers[0];
      if (operation === undefined) throw new Error('Missing operation');
      expect(
        signedArea(collectLayerPolylines(scene.objects, operation, DEFAULT_DEVICE_PROFILE)),
      ).toBeCloseTo(60, 6);
      expect(joinFraction(scene)).toBeGreaterThan(0.98);
      expect(JSON.stringify(scene)).toBe(before);
    },
  );
  it.each([undefined, 'evenodd'] as const)('preserves an SVG %s knockout', (fillRule) => {
    expect(joinFraction(sourceScene([vector(fillRule)]))).toBe(0);
  });
  it('keeps separate overlapping text objects as an even-odd knockout', () => {
    expect(joinFraction(sourceScene([text('a', [box(10)]), text('b', [box(14)])]))).toBe(0);
  });
  it('preserves oppositely wound counters in the emitted pocket', () => {
    const hole = box(12, 12, 2);
    const source = sourceScene([
      text('counter', [box(10), { ...hole, points: [...hole.points].reverse() }]),
    ]);
    const moves = pocketMoves(source);
    const point = toMachineCoords({ x: 13, y: 13 }, DEFAULT_DEVICE_PROFILE);
    expect(moves.some((move) => cutsAt(point, -0.1, move))).toBe(false);
  });
  it('does not turn open text strokes into closed inlay material', () => {
    const source = sourceScene([text('stroke', [{ ...box(10), closed: false }])]);
    expect(compileCncJob(source, DEFAULT_DEVICE_PROFILE, CONFIG).groups).toEqual([]);
  });
});
