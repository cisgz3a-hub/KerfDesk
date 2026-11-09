// Test support: relief scenes and an analytic stock simulator of emitted CNC
// G-code, ported from the rolling audit v12 X6 refuter's harness (zz-x6r/x.mts).
// For every feed move and every grid cell the cutter bottom is solved exactly:
// the interval of the move where the cell lies under the tool disc comes from
// |p - xy(t)|² ≤ R²; a flat end mill takes the lower end of z(t) there, and a
// ball minimises the convex z(t) + R - sqrt(R² - d(t)²) by golden-section
// search. Arcs are refused, so no arc approximation hides anything.
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
  type Polyline,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';

/** A height-map relief from depth below the top (≥ 0) at relief-local (x, y). */
export function stockRelief(options: {
  readonly w: number;
  readonly h: number;
  readonly px: number;
  readonly maxDepth: number;
  readonly at: readonly [number, number];
  readonly layer: string;
  readonly depth: (x: number, y: number) => number;
}): ReliefObject {
  const width = Math.round(options.w / options.px);
  const height = Math.round(options.h / options.px);
  const samplesU16: number[] = [];
  for (let j = 0; j < height; j += 1)
    for (let i = 0; i < width; i += 1) {
      const d = options.depth((i + 0.5) * options.px, (j + 0.5) * options.px);
      const clamped = Math.min(options.maxDepth, Math.max(0, d));
      samplesU16.push(Math.round(((options.maxDepth - clamped) / options.maxDepth) * 65535));
    }
  const [x, y] = options.at;
  return {
    kind: 'relief',
    id: 'rel',
    source: 'rel.png',
    color: '#a0522d',
    reliefSource: testReliefHeightfield({
      width,
      height,
      physicalWidthMm: options.w,
      physicalHeightMm: options.h,
      maxDepthMm: options.maxDepth,
      samplesU16,
    }),
    targetWidthMm: options.w,
    reliefDepthMm: options.maxDepth,
    bounds: { minX: x, minY: y, maxX: x + options.w, maxY: y + options.h },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    operationIds: [options.layer],
  } as ReliefObject;
}

export function circleLoop(cx: number, cy: number, r: number, n = 120): Polyline {
  const points = Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  }));
  return { closed: true, points };
}

export function squareLoop(x: number, y: number, w: number): Polyline {
  const points = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + w },
    { x, y: y + w },
  ];
  return { closed: true, points };
}

export function vectorObject(layer: string, polylines: ReadonlyArray<Polyline>): SceneObject {
  const xs = polylines.flatMap((line) => line.points.map((p) => p.x));
  const ys = polylines.flatMap((line) => line.points.map((p) => p.y));
  return {
    kind: 'imported-svg',
    id: 'vec',
    source: 'vec.svg',
    operationIds: [layer],
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
  } as SceneObject;
}

export function cncLayer(id: string, cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id, color: id === 'r' ? '#a0522d' : '#000000', name: id }),
    output: true,
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
}

export function stockProject(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
  stockMm: number,
): Project {
  const base = createProject();
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: stockMm },
    },
    scene: { ...base.scene, objects, artworkOrder: objects.map((o) => o.id), layers },
  } as Project;
}

export type SimMove = {
  readonly layer: string;
  readonly tool: string;
  readonly rapid: boolean;
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  // Most stock this move took off any one cell, and off the cells on its centre line.
  readonly maxRem: number;
  readonly centreRem: number;
  readonly vol: number;
  readonly len: number;
};

export type StockSim = {
  readonly moves: ReadonlyArray<SimMove>;
  // Stock top Z (0 = stock top) at a machine-coordinate point after the program.
  readonly at: (x: number, y: number) => number;
};

const PHI = (Math.sqrt(5) - 1) / 2;

/** Simulate the emitted program's stock removal over a grid of `G` mm cells. */
export function simulateStock(project: Project, gcode: string, G = 0.05, margin = 10): StockSim {
  if (/^G0?[23](?!\d)/m.test(gcode)) throw new Error('arc moves present');
  const tools = new Map(
    (project.machine?.kind === 'cnc' ? project.machine.tools : []).map((t) => [t.id, t]),
  );
  const lines = gcode.split(/\r?\n/);
  const bounds = programBounds(lines);
  const X0 = bounds.minX - margin;
  const Y0 = bounds.minY - margin;
  const NX = Math.ceil((bounds.maxX - X0 + margin) / G) + 1;
  const NY = Math.ceil((bounds.maxY - Y0 + margin) / G) + 1;
  const grid: Grid = { top: new Float64Array(NX * NY), X0, Y0, NX, NY, G };
  const moves: SimMove[] = [];
  const head: Head = { x: 0, y: 0, z: 1e3, mode: 0, tool: '', layer: '' };
  for (const line of lines) {
    const to = readLine(line, head);
    if (to === null) continue;
    const tool = tools.get(head.tool);
    if (tool !== undefined && Math.min(head.z, to.z) < 1e-4) {
      const cut = cutMove(tool, head, to, grid);
      if (head.mode === 1 || cut.vol > 1e-4) moves.push(simMove(head, to, cut));
    }
    Object.assign(head, to);
  }
  const at = (x: number, y: number): number => {
    const gx = Math.round((x - X0) / G);
    const gy = Math.round((y - Y0) / G);
    return gx < 0 || gy < 0 || gx >= NX || gy >= NY ? 0 : (grid.top[gy * NX + gx] ?? 0);
  };
  return { moves, at };
}

type Head = { x: number; y: number; z: number; mode: number; tool: string; layer: string };
type Point3 = { readonly x: number; readonly y: number; readonly z: number };

// Follow one program line: section comments set the tool and layer, motion
// words the mode, and an axis word gives the move's end (null otherwise).
function readLine(line: string, head: Head): Point3 | null {
  followComments(line, head);
  if (line.startsWith(';') || line.startsWith('(') || /^G(28|30|53|92)/.test(line)) return null;
  const motion = /\bG0?([01])(?!\d)/.exec(line)?.[1];
  if (motion !== undefined) head.mode = Number(motion);
  const x = axisWord(line, 'X');
  const y = axisWord(line, 'Y');
  const z = axisWord(line, 'Z');
  if (x === null && y === null && z === null) return null;
  return { x: x ?? head.x, y: y ?? head.y, z: z ?? head.z };
}

function followComments(line: string, head: Head): void {
  const toolId = /cnc tool-id: (\S+)/.exec(line)?.[1];
  if (toolId !== undefined) head.tool = toolId;
  const layerId = /cnc layer-id: (\S+)/.exec(line)?.[1];
  if (layerId !== undefined) head.layer = layerId;
}

function axisWord(line: string, axis: string): number | null {
  const value = new RegExp(axis + '(-?\\d+\\.?\\d*)').exec(line)?.[1];
  return value === undefined ? null : Number(value);
}

function simMove(
  head: Head,
  to: Point3,
  cut: { maxRem: number; centreRem: number; vol: number },
): SimMove {
  return {
    layer: head.layer,
    tool: head.tool,
    rapid: head.mode === 0,
    x0: head.x,
    y0: head.y,
    z0: head.z,
    x1: to.x,
    y1: to.y,
    z1: to.z,
    ...cut,
    len: Math.hypot(to.x - head.x, to.y - head.y),
  };
}

function programBounds(lines: ReadonlyArray<string>) {
  let [minX, minY, maxX, maxY] = [1e9, 1e9, -1e9, -1e9];
  for (const line of lines) {
    if (line.startsWith(';')) continue;
    const x = /X(-?\d+\.?\d*)/.exec(line)?.[1];
    const y = /Y(-?\d+\.?\d*)/.exec(line)?.[1];
    if (x !== undefined) [minX, maxX] = [Math.min(minX, +x), Math.max(maxX, +x)];
    if (y !== undefined) [minY, maxY] = [Math.min(minY, +y), Math.max(maxY, +y)];
  }
  return { minX: Math.max(minX, -1), minY: Math.max(minY, -1), maxX, maxY };
}

type Grid = {
  readonly top: Float64Array;
  readonly X0: number;
  readonly Y0: number;
  readonly NX: number;
  readonly NY: number;
  readonly G: number;
};

function cutMove(
  tool: { readonly kind: string; readonly diameterMm: number },
  a: Point3,
  b: Point3,
  grid: Grid,
): { maxRem: number; centreRem: number; vol: number } {
  if (tool.kind !== 'ball-nose' && tool.kind !== 'end-mill') throw new Error(tool.kind);
  const { top, X0, Y0, NX, NY, G } = grid;
  const R = tool.diameterMm / 2;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const ee = ex * ex + ey * ey;
  const [gx0, gx1] = cellSpan(a.x, b.x, R, X0, NX, G);
  const [gy0, gy1] = cellSpan(a.y, b.y, R, Y0, NY, G);
  let [maxRem, centreRem, vol] = [0, 0, 0];
  for (let gy = gy0; gy <= gy1; gy += 1)
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const qx = X0 + gx * G - a.x;
      const qy = Y0 + gy * G - a.y;
      const bottom = cellBottom(tool, a, b, qx, qy);
      if (bottom === null) continue;
      const i = gy * NX + gx;
      const current = top[i] ?? 0;
      if (current <= bottom) continue;
      const rem = current - bottom;
      vol += rem * G * G;
      maxRem = Math.max(maxRem, rem);
      const t = ee < 1e-12 ? 0 : Math.max(0, Math.min(1, (qx * ex + qy * ey) / ee));
      if (Math.hypot(qx - t * ex, qy - t * ey) <= G * 0.75) centreRem = Math.max(centreRem, rem);
      top[i] = bottom;
    }
  return { maxRem, centreRem, vol };
}

// The grid cells a move's swept disc can reach along one axis.
function cellSpan(
  from: number,
  to: number,
  R: number,
  origin: number,
  cells: number,
  G: number,
): readonly [number, number] {
  return [
    Math.max(0, Math.floor((Math.min(from, to) - R - origin) / G)),
    Math.min(cells - 1, Math.ceil((Math.max(from, to) + R - origin) / G)),
  ];
}

// The cutter's lowest point over one cell during a move, or null off its path.
function cellBottom(
  tool: { readonly kind: string; readonly diameterMm: number },
  a: Point3,
  b: Point3,
  qx: number,
  qy: number,
): number | null {
  const R = tool.diameterMm / 2;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const interval = insideInterval(qx, qy, ex, ey, ex * ex + ey * ey, R);
  if (interval === null) return null;
  const zt = (t: number): number => a.z + (b.z - a.z) * t;
  return tool.kind === 'ball-nose'
    ? ballBottom(zt, qx, qy, ex, ey, R, interval)
    : Math.min(zt(interval[0]), zt(interval[1]));
}

function insideInterval(
  qx: number,
  qy: number,
  ex: number,
  ey: number,
  ee: number,
  R: number,
): readonly [number, number] | null {
  if (ee < 1e-12) return qx * qx + qy * qy > R * R ? null : [0, 1];
  const b = qx * ex + qy * ey;
  const c = qx * qx + qy * qy - R * R;
  const disc = b * b - ee * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = Math.max(0, (b - s) / ee);
  const t2 = Math.min(1, (b + s) / ee);
  return t1 > t2 ? null : [t1, t2];
}

function ballBottom(
  zt: (t: number) => number,
  qx: number,
  qy: number,
  ex: number,
  ey: number,
  R: number,
  [t1, t2]: readonly [number, number],
): number {
  const fz = (t: number): number => {
    const dx = qx - t * ex;
    const dy = qy - t * ey;
    return zt(t) + R - Math.sqrt(Math.max(0, R * R - dx * dx - dy * dy));
  };
  let lo = t1;
  let hi = t2;
  if (hi - lo > 1e-9) {
    let c1 = hi - PHI * (hi - lo);
    let c2 = lo + PHI * (hi - lo);
    let f1 = fz(c1);
    let f2 = fz(c2);
    for (let k = 0; k < 40; k += 1) {
      if (f1 < f2) {
        hi = c2;
        c2 = c1;
        f2 = f1;
        c1 = hi - PHI * (hi - lo);
        f1 = fz(c1);
      } else {
        lo = c1;
        c1 = c2;
        f1 = f2;
        c2 = lo + PHI * (hi - lo);
        f2 = fz(c2);
      }
    }
  }
  return Math.min(fz((lo + hi) / 2), fz(t1), fz(t2));
}

/** The material above the stock bottom along a closed scene loop: the most at
 * any point, and each holding run's (bridge's) thickness, its highest point. */
export function loopMaterial(
  project: Project,
  sim: StockSim,
  loop: Polyline,
  stockMm: number,
  step = 0.05,
): { readonly most: number; readonly bridges: ReadonlyArray<number> } {
  const points = [...loop.points, ...loop.points.slice(0, 1)].map((p) =>
    toMachineCoords(p, project.device),
  );
  const left: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k += 1)
      left.push(sim.at(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n) + stockMm);
  }
  return { most: Math.max(...left), bridges: holdingRuns(left) };
}

// Each run of points keeping material (over 0.01 mm), by its highest point,
// read round the loop from a point that keeps none.
function holdingRuns(left: ReadonlyArray<number>): ReadonlyArray<number> {
  const start = left.findIndex((value) => value <= 0.01);
  if (start < 0) return [];
  const runs: number[] = [];
  let run: number | null = null;
  for (let k = 0; k < left.length; k += 1) {
    const value = left[(start + k) % left.length] ?? 0;
    if (value > 0.01) run = Math.max(run ?? 0, value);
    else if (run !== null) {
      runs.push(run);
      run = null;
    }
  }
  if (run !== null) runs.push(run);
  return runs;
}
