// Test support: relief scenes and an analytic stock simulator of emitted CNC
// G-code, ported from the rolling audit v12 X6 refuter's harness (zz-x6r/x.mts).
// For every feed move and every grid cell the cutter bottom is solved exactly:
// the interval of the move where the cell lies under the tool disc comes from
// |p - xy(t)|² ≤ R²; a flat end mill takes the lower end of z(t) there, and a
// ball minimises the convex z(t) + R - sqrt(R² - d(t)²) by golden-section
// search. Arcs are refused, so no arc approximation hides anything.
import { toMachineCoords } from '../../core/devices';
import { kernelForTool } from '../../core/sim';
import type { CncTool, Polyline, Project } from '../../core/scene';
export {
  circleLoop,
  cncLayer,
  squareLoop,
  stockProject,
  stockRelief,
  vectorObject,
} from './relief-gcode-scenes.test-support';

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
  // Most stock this move took off any one cell; and the most its pass (the feed
  // moves since the last rapid) has taken in all off a cell on its centre line.
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
  const grid = newGrid(programBounds(lines), G, margin);
  const moves: SimMove[] = [];
  const head: Head = { x: 0, y: 0, z: 1e3, mode: 0, tool: '', layer: '' };
  for (const line of lines) {
    const to = readLine(line, head);
    if (to === null) continue;
    const move = feedMove(tools.get(head.tool), head, to, grid);
    if (move !== null) moves.push(move);
    Object.assign(head, to);
  }
  const at = (x: number, y: number): number => {
    const gx = Math.round((x - grid.X0) / G);
    const gy = Math.round((y - grid.Y0) / G);
    return gx < 0 || gy < 0 || gx >= grid.NX || gy >= grid.NY
      ? 0
      : (grid.top[gy * grid.NX + gx] ?? 0);
  };
  return { moves, at };
}

function newGrid(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  G: number,
  margin: number,
): Grid {
  const X0 = bounds.minX - margin;
  const Y0 = bounds.minY - margin;
  const NX = Math.ceil((bounds.maxX - X0 + margin) / G) + 1;
  const NY = Math.ceil((bounds.maxY - Y0 + margin) / G) + 1;
  return {
    top: new Float64Array(NX * NY),
    passOf: new Int32Array(NX * NY).fill(-1),
    passRem: new Float32Array(NX * NY),
    pass: { id: 0, heading: null },
    X0,
    Y0,
    NX,
    NY,
    G,
  };
}

// Cut one move into the grid; a rapid, or a move clear of the stock, ends the
// pass. Returns the move's record when it cut, or when it was a feed move.
function feedMove(tool: CncTool | undefined, head: Head, to: Point3, grid: Grid): SimMove | null {
  const inStock = Math.min(head.z, to.z) < 1e-4;
  if (head.mode === 0 || !inStock) newPass(grid.pass, null);
  else followRow(grid.pass, to.x - head.x, to.y - head.y);
  if (tool === undefined || !inStock) return null;
  const cut = cutMove(tool, head, to, grid);
  return head.mode === 1 || cut.vol > 1e-4 ? simMove(head, to, cut) : null;
}

function newPass(pass: Grid['pass'], heading: Grid['pass']['heading']): void {
  pass.id += 1;
  pass.heading = heading;
}

// A turn of more than 60° from the row's first heading starts a new row.
function followRow(pass: Grid['pass'], dx: number, dy: number): void {
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return;
  const here = { x: dx / length, y: dy / length };
  if (pass.heading === null) pass.heading = here;
  else if (here.x * pass.heading.x + here.y * pass.heading.y < 0.5) newPass(pass, here);
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
  // CNC audit v3 N7: the load "under the tip per pass" is what one row takes
  // off a cell in all, not what one of its moves takes: a row descending a
  // slope cuts the same cell over several short moves. Each cell keeps the
  // row that last cut it and its total. N8-P3-2: a row is the feed moves
  // between two rapids, cut short where the path turns more than 60° from the
  // heading the row started on, so the rows of a back-and-forth finish are
  // each their own (the stock an earlier row's flank took is not this row's).
  readonly passOf: Int32Array;
  readonly passRem: Float32Array;
  readonly pass: { id: number; heading: { x: number; y: number } | null };
  readonly X0: number;
  readonly Y0: number;
  readonly NX: number;
  readonly NY: number;
  readonly G: number;
};

function cutMove(
  tool: CncTool,
  a: Point3,
  b: Point3,
  grid: Grid,
): { maxRem: number; centreRem: number; vol: number } {
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
      const i = gy * NX + gx;
      const current = top[i] ?? 0;
      // The cutter's bottom over this cell is at least its lower tip plus its
      // rise at the cell's nearest distance to the path: a cell already at or
      // below that cannot be cut, so it needs no search (exact, not a guess).
      if (current <= Math.min(a.z, b.z) + lowestRise(tool, qx, qy, b.x - a.x, b.y - a.y)) continue;
      const bottom = cellBottom(tool, a, b, qx, qy);
      if (bottom === null) continue;
      if (current <= bottom) continue;
      const rem = current - bottom;
      vol += rem * G * G;
      maxRem = Math.max(maxRem, rem);
      const t = ee < 1e-12 ? 0 : Math.max(0, Math.min(1, (qx * ex + qy * ey) / ee));
      if (grid.passOf[i] !== grid.pass.id) {
        grid.passOf[i] = grid.pass.id;
        grid.passRem[i] = 0;
      }
      grid.passRem[i] = (grid.passRem[i] ?? 0) + rem;
      if (Math.hypot(qx - t * ex, qy - t * ey) <= G * 0.75)
        centreRem = Math.max(centreRem, grid.passRem[i] ?? rem);
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

// The cutter's rise at the cell's nearest XY distance to the move.
function lowestRise(tool: CncTool, qx: number, qy: number, ex: number, ey: number): number {
  const ee = ex * ex + ey * ey;
  const t = ee < 1e-12 ? 0 : Math.max(0, Math.min(1, (qx * ex + qy * ey) / ee));
  const d = Math.hypot(qx - t * ex, qy - t * ey);
  if (d > tool.diameterMm / 2) return Number.POSITIVE_INFINITY;
  return tool.kind === 'end-mill' ? 0 : cutterRise(tool)(d);
}

// The cutter's lowest point over one cell during a move, or null off its path.
function cellBottom(tool: CncTool, a: Point3, b: Point3, qx: number, qy: number): number | null {
  const R = tool.diameterMm / 2;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const interval = insideInterval(qx, qy, ex, ey, ex * ex + ey * ey, R);
  if (interval === null) return null;
  const zt = (t: number): number => a.z + (b.z - a.z) * t;
  if (tool.kind === 'end-mill') return Math.min(zt(interval[0]), zt(interval[1]));
  return ballBottom(zt, qx, qy, ex, ey, cutterRise(tool), interval);
}

// The cutter's rise above its tip at a radius: an exact ball, or for a
// narrowing bit (tapered ball, V-bit, engraver) the app's own cutter law.
const rises = new WeakMap<CncTool, (d: number) => number>();

function cutterRise(tool: CncTool): (d: number) => number {
  const known = rises.get(tool);
  if (known !== undefined) return known;
  const R = tool.diameterMm / 2;
  let rise: (d: number) => number;
  if (tool.kind === 'ball-nose') rise = (d) => R - Math.sqrt(Math.max(0, R * R - d * d));
  else {
    const law = kernelForTool(tool, Math.max(R / 50, 1e-3)).surfaceDzAtRadius;
    rise = (d) => law(Math.min(d, R));
  }
  rises.set(tool, rise);
  return rise;
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
  rise: (d: number) => number,
  [t1, t2]: readonly [number, number],
): number {
  const fz = (t: number): number => zt(t) + rise(Math.hypot(qx - t * ex, qy - t * ey));
  let lo = t1;
  let hi = t2;
  if (hi - lo > 1e-9) {
    let c1 = hi - PHI * (hi - lo);
    let c2 = lo + PHI * (hi - lo);
    let f1 = fz(c1);
    let f2 = fz(c2);
    // 24 golden steps leave 0.618^24 ≈ 1e-5 of the move: far below the grid.
    for (let k = 0; k < 24; k += 1) {
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
