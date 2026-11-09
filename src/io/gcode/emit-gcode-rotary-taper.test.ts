import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import type { RotaryTaper } from '../../core/devices/rotary';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

// ADR-694 (rolling audit v12 X8-P2-2): a tumbler Ø80 at the rim and Ø70 at the
// base over 100 mm, in the Creality chuck (40 machine mm per turn). The
// emitted program is replayed onto that cone: each lit point's machine Y is an
// angle, and its surface position round the part is that angle times the
// cone's radius at the point's X.

const MM_PER_TURN = 40;
const TAPER: RotaryTaper = {
  enabled: true,
  topDiameterMm: 80,
  bottomDiameterMm: 70,
  lengthMm: 100,
  topSide: 'left',
  artworkFromTopMm: 0,
};
const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: MM_PER_TURN,
  objectDiameterMm: 80,
};
const TAPERED: RotarySetup = { ...CHUCK, taper: TAPER };

// The artwork's top-side edge is X 0 and sits at the rim, so X is distance
// down the side.
function coneRadiusAt(x: number): number {
  return 40 - (5 * x) / 100;
}

function polylineProject(
  rotary: RotarySetup,
  polylines: ReadonlyArray<ReadonlyArray<Vec2>>,
): Project {
  const xs = polylines.flat().map((p) => p.x);
  const ys = polylines.flat().map((p) => p.y);
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: polylines.map((points) => ({
          points: [...points],
          closed: points.length > 2,
        })),
      },
    ],
  };
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary });
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

function square(x: number, y: number, size: number): ReadonlyArray<Vec2> {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ];
}

/** The points the program burns through: the end of every G1 with a lit
 * laser, and the point each lit run starts from. */
function word(line: string, letter: string): number | undefined {
  const match = new RegExp(`${letter}(-?\\d+(?:\\.\\d+)?)`).exec(line);
  return match === null ? undefined : Number(match[1]);
}

function litPoints(gcode: string): ReadonlyArray<Vec2> {
  const points: Vec2[] = [];
  let at = { x: 0, y: 0 };
  let lit = false;
  for (const raw of gcode.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (/\bM5\b/.test(line)) lit = false;
    if (/\bM[34]\b/.test(line)) lit = true;
    const from = at;
    at = { x: word(line, 'X') ?? at.x, y: word(line, 'Y') ?? at.y };
    const power = word(line, 'S');
    if (/^G1\b/.test(line) && lit && (power === undefined || power > 0)) points.push(from, at);
  }
  return points;
}

/** Surface length round the part covered by the lit points at one X. */
function surfaceSpanAt(points: ReadonlyArray<Vec2>, x: number): number {
  const ys = points.filter((p) => Math.abs(p.x - x) < 1e-6).map((p) => p.y);
  expect(ys.length).toBeGreaterThan(1);
  const turns = (Math.max(...ys) - Math.min(...ys)) / MM_PER_TURN;
  return turns * 2 * Math.PI * coneRadiusAt(x);
}

describe('rotary taper warp in the emitted G-code (ADR-694)', () => {
  it('burns a 20 mm square 20 mm round the glass at the rim and at the base', () => {
    const project = polylineProject(TAPERED, [square(0, 0, 20), square(80, 0, 20)]);
    const result = emitGcode(project);
    expect(result.preflight.ok).toBe(true);
    const points = litPoints(result.gcode);
    // Both vertical edges of both squares, each at its own height on the cone.
    for (const x of [0, 20, 80, 100]) {
      expect(surfaceSpanAt(points, x)).toBeCloseTo(20, 2);
    }
    // Along the glass the squares keep their 20 mm.
    const xs = points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(100, 3);
  });

  it('without the taper burns the base square 11.3 % short, as the audit measured', () => {
    const project = polylineProject(CHUCK, [square(0, 0, 20), square(80, 0, 20)]);
    const points = litPoints(emitGcode(project).gcode);
    // Ø80 entered: the rim edge is right; the base square's edges burn 18 and
    // 17.5 mm round the part (17.75 through its middle).
    expect(surfaceSpanAt(points, 0)).toBeCloseTo(20, 2);
    expect(surfaceSpanAt(points, 80)).toBeCloseTo(18, 2);
    expect(surfaceSpanAt(points, 100)).toBeCloseTo(17.5, 2);
  });

  it('runs exactly one turn for one turn of surface at every height', () => {
    // Lines centred on one row, so together they also fit one turn.
    const heights = [0, 10, 50, 90, 100];
    const lines = heights.map((x) => {
      const turn = 2 * Math.PI * coneRadiusAt(x);
      return [
        { x, y: 200 - turn / 2 },
        { x, y: 200 + turn / 2 },
      ];
    });
    const project = polylineProject(TAPERED, lines);
    const result = emitGcode(project);
    expect(result.preflight.ok).toBe(true);
    const points = litPoints(result.gcode);
    for (const x of heights) {
      const ys = points.filter((p) => Math.abs(p.x - x) < 1e-6).map((p) => p.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(MM_PER_TURN, 3);
    }
  });

  it('follows the curve an edge along the glass becomes', () => {
    // The top edge of a square spanning the whole taper: round the narrow end
    // the same surface height is a bigger angle, so the edge curves.
    const project = polylineProject(TAPERED, [square(0, 0, 100)]);
    const points = litPoints(emitGcode(project).gcode);
    // The warp pivots on the square's middle row, half way between its two
    // edges at the rim.
    const rim = points.filter((p) => Math.abs(p.x) < 1e-6).map((p) => p.y);
    const pivotY = (Math.max(...rim) + Math.min(...rim)) / 2;
    const alongEdges = points.filter((p) => p.x > 0.5 && p.x < 99.5);
    // Densified: more than the square's own corners.
    expect(alongEdges.length).toBeGreaterThan(8);
    for (const p of alongEdges) {
      const surface = (Math.abs(p.y - pivotY) / MM_PER_TURN) * 2 * Math.PI * coneRadiusAt(p.x);
      expect(surface).toBeCloseTo(50, 1);
    }
  });

  it('honours the side the top is on and the gap to the artwork', () => {
    // Top on the right, artwork 30 mm from the rim: the square's right edge is
    // 30 mm down the side (Ø77), its left edge 50 mm down (Ø75).
    const rightTop: RotarySetup = {
      ...CHUCK,
      taper: { ...TAPER, topSide: 'right', artworkFromTopMm: 30 },
    };
    const points = litPoints(emitGcode(polylineProject(rightTop, [square(10, 0, 20)])).gcode);
    const turnsAt = (x: number): number => {
      const ys = points.filter((p) => Math.abs(p.x - x) < 1e-6).map((p) => p.y);
      return (Math.max(...ys) - Math.min(...ys)) / MM_PER_TURN;
    };
    expect(turnsAt(30) * Math.PI * 77).toBeCloseTo(20, 2);
    expect(turnsAt(10) * Math.PI * 75).toBeCloseTo(20, 2);
  });

  it('checks the wrap limit where the part is narrowest', () => {
    // 230 mm fits one turn of the Ø80 rim (251.3) but not the Ø70 base (219.9).
    const nearRim = polylineProject(TAPERED, [
      [
        { x: 0, y: 0 },
        { x: 0, y: 230 },
      ],
    ]);
    const nearBase = polylineProject(TAPERED, [
      [
        { x: 100, y: 0 },
        { x: 100, y: 230 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
    ]);
    expect(emitGcode(nearRim).preflight.ok).toBe(true);
    const tooTall = emitGcode(nearBase).preflight;
    expect(tooTall.ok).toBe(false);
    expect(tooTall.issues.some((issue) => issue.code === 'out-of-bed')).toBe(true);
  });

  it('keeps output byte-identical with the taper absent or off', () => {
    const shapes = [square(0, 0, 20), square(80, 0, 20)];
    const absent = emitGcode(polylineProject(CHUCK, shapes)).gcode;
    const off = emitGcode(
      polylineProject({ ...CHUCK, taper: { ...TAPER, enabled: false } }, shapes),
    ).gcode;
    expect(off).toBe(absent);
  });
});
