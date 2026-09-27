// ADR-471: a ramp entry on a path shorter than its ramp. Closed loops lap,
// open paths zig-zag, each pass ramps from the level its own path was cut to,
// and a path under one cut width keeps its plunge and says so.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Vec3 } from '../geometry/vec3';
import type { CncContourPass, CncGroup, CncPass } from '../job';
import { cncGrblStrategy } from '../output';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES, runCncPreflight } from '../preflight';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
  type Project,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { applyRampEntry } from './motion-polish';

const TAN_5 = Math.tan((5 * Math.PI) / 180);

function square(x0: number, y0: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x0 + size, y: y0 },
      { x: x0 + size, y: y0 + size },
      { x: x0, y: y0 + size },
    ],
  };
}

function contour(polyline: Polyline, zMm: number): CncContourPass {
  const points = polyline.closed ? [...polyline.points, polyline.points[0]!] : polyline.points;
  return { kind: 'contour', zMm, polyline: points, closed: polyline.closed };
}

function path3d(pass: CncPass | undefined): ReadonlyArray<Vec3> {
  if (pass?.kind !== 'path3d') throw new Error('expected a ramped path3d pass');
  return pass.points;
}

// Every descending segment keeps within the angle, and none is a straight
// descent at one XY.
function expectRampWithin(points: ReadonlyArray<Vec3>, tangent: number): void {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (!(b.z < a.z)) continue;
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    expect(run).toBeGreaterThan(0);
    expect((a.z - b.z) / run).toBeLessThanOrEqual(tangent + 1e-9);
  }
}

function lengthAt(points: ReadonlyArray<Vec3>, zMm: number): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (a.z === zMm && b.z === zMm) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

type Descent = { readonly line: string; readonly previous: string; readonly sameXy: boolean };
type At = { readonly x: string; readonly y: string; readonly z: number };

// Feed moves that descend below the stock top, each with the line before it.
// Ramps are compact modal lines (`G1X..Y..Z..`, then `X..Y..Z..`, ADR-472).
function descentsBelowStockTop(gcode: string): Descent[] {
  const descents: Descent[] = [];
  let at: At = { x: '', y: '', z: 0 };
  let previous = '';
  let mode = '';
  for (const line of gcode.split('\n')) {
    const motion = /^G([01])(?![0-9])/.exec(line);
    if (motion !== null) mode = `G${motion[1]}`;
    if (line.startsWith(';') || !/[XYZ]/.test(line) || mode === '') continue;
    const next = movedTo(line, at);
    if (mode === 'G1' && next.z < Math.min(at.z, 0)) {
      descents.push({ line, previous, sameXy: next.x === at.x && next.y === at.y });
    }
    previous = line;
    at = next;
  }
  return descents;
}

function movedTo(line: string, at: At): At {
  const word = (letter: string): string | undefined =>
    new RegExp(`${letter}(-?\\d+\\.\\d+)`).exec(line)?.[1];
  return {
    x: word('X') ?? at.x,
    y: word('Y') ?? at.y,
    z: Number(word('Z') ?? at.z),
  };
}

describe('applyRampEntry on paths shorter than their ramp (ADR-471)', () => {
  it('laps a closed loop at the angle, then cuts one whole lap at depth', () => {
    // An 8 mm loop and a 1.5 mm drop at 5°: a 17.1 mm ramp, just over two laps.
    const [ramped] = applyRampEntry([contour(square(0, 0, 2), -1.5)], 5, false, 3.175);
    const points = path3d(ramped);
    expectRampWithin(points, TAN_5);
    expect(points[0]).toEqual({ x: 0, y: 0, z: 0 });
    const reached = points.findIndex((point) => point.z === -1.5);
    let ramp = 0;
    for (let index = 1; index <= reached; index += 1) {
      const a = points[index - 1]!;
      const b = points[index]!;
      ramp += Math.hypot(b.x - a.x, b.y - a.y);
    }
    // Whole 0.001 mm steps make it a little longer than the angle's 17.1 mm
    // (ADR-472), never shorter.
    expect(ramp).toBeGreaterThanOrEqual(1.5 / TAN_5);
    expect(ramp).toBeLessThan((1.5 / TAN_5) * 1.01);
    expect(lengthAt(points, -1.5)).toBeCloseTo(8, 9);
    expect(points.at(-1)).toEqual(points[reached]);
  });

  it('zig-zags an open path back to its start at depth, then cuts it end to end', () => {
    const line: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    };
    const [ramped] = applyRampEntry([contour(line, -1)], 5, false, 3.175);
    const points = path3d(ramped);
    expectRampWithin(points, TAN_5);
    const reached = points.findIndex((point) => point.z === -1);
    expect(points[reached]).toEqual({ x: 0, y: 0, z: -1 });
    expect(points.slice(reached)).toEqual([
      { x: 0, y: 0, z: -1 },
      { x: 5, y: 0, z: -1 },
    ]);
  });

  it('keeps the plunge, marked, on a path under one cut width', () => {
    const tiny = contour(square(0, 0, 0.285), -1.5);
    const [kept] = applyRampEntry([tiny], 5, false, 3.175);
    expect(kept).toEqual({ ...tiny, entryPlunge: true });
    // A path the ramp fits along once still ramps, however short.
    const [steep] = applyRampEntry([contour(square(0, 0, 0.5), -0.5)], 45, false, 3.175);
    expect(steep?.kind).toBe('path3d');
  });

  it('ramps each ring of a pocket ladder from the level above', () => {
    const outer = square(0, 0, 20);
    const inner = square(5, 5, 10);
    const passes = applyRampEntry(
      [contour(inner, -1.5), contour(outer, -1.5), contour(inner, -3), contour(outer, -3)],
      5,
      false,
      3.175,
    );
    expect(passes.map((pass) => path3d(pass)[0]?.z)).toEqual([0, 0, -1.5, -1.5]);
  });
});

describe('the reported 6 mm pocket (ADR-471)', () => {
  // A 6 mm square pocket, 3 mm deep at 1.5 mm per pass, 5° ramp, 3.175 mm end
  // mill: the 0.285 mm inner ring ramped 0.1 mm, then went straight down to
  // each level, as did the outer ring after 0.99 mm; the header claimed 5°.
  const settings: CncLayerSettings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: 'pocket',
    depthMm: 3,
    depthPerPassMm: 1.5,
    rampEntryDeg: 5,
  };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'pocket.svg',
    bounds: { minX: 10, minY: 10, maxX: 16, maxY: 16 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [square(10, 10, 6)] }],
  };
  const scene: Scene = {
    objects: [object],
    layers: [{ ...createLayer({ id: '#ff0000', color: '#ff0000' }), cnc: settings }],
  };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups.find((candidate): candidate is CncGroup => candidate.kind === 'cnc');
  const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

  it('laps the outer ring from the level above and plunges only the marked inner ring', () => {
    const passes = group?.passes ?? [];
    expect(passes.map((pass) => pass.kind)).toEqual(['contour', 'path3d', 'contour', 'path3d']);
    expect(passes.filter((pass) => pass.kind === 'contour' && pass.entryPlunge)).toHaveLength(2);
    expect(path3d(passes[1])[0]?.z).toBe(0);
    expect(path3d(passes[3])[0]?.z).toBe(-1.5);
    for (const pass of passes) {
      if (pass.kind === 'path3d') expectRampWithin(pass.points, TAN_5);
    }
  });

  it('never finishes a ramp straight down, and says which passes plunge', () => {
    // Every straight descent below the stock top starts a pass after a rapid.
    const descents = descentsBelowStockTop(gcode);
    for (const descent of descents.filter((candidate) => candidate.sameXy)) {
      expect(descent.previous, descent.line).toMatch(/^G0 X/);
    }
    expect(descents.some((descent) => !descent.sameXy)).toBe(true);
    expect(gcode).toContain('; cnc entry: contour-ramp; max-angle-deg: 5.000');
    expect(gcode).toContain(
      '; cnc entry-advisory: 2 passes plunge: path shorter than one cut width',
    );
  });

  it('reports the plunges as a Job Review advisory, never a refusal', () => {
    const project: Project = { ...createProject(), scene };
    const issues = runCncPreflight(project, DEFAULT_CNC_MACHINE_CONFIG, gcode, {
      compiledJob: job,
      sourceGeometryChecks: 'compiled-evidence-only',
    }).issues.filter((issue) => issue.code === 'cnc-ramp-entry-plunge');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('Layer #ff0000: 2 passes plunge straight down');
    expect(COMPILE_INTEGRITY_PREFLIGHT_CODES.has('cnc-ramp-entry-plunge')).toBe(false);
  });
});
