import type { LaserSecondPassPoint, LaserSecondPassSegment, LaserSecondPassStroke } from './types';

type OracleState = {
  x: number;
  y: number;
  unit: number;
  absolute: boolean;
  rapid: boolean;
  enabled: boolean;
  mode: 3 | 4;
  power: number;
  feed: number;
};

function oracleModal(state: OracleState, letter: string, code: number): void {
  if (letter === 'G') {
    if (code === 0 || code === 1) state.rapid = code === 0;
    if (code === 20 || code === 21) state.unit = code === 20 ? 25.4 : 1;
    if (code === 90 || code === 91) state.absolute = code === 90;
  } else {
    if (code === 3 || code === 4) {
      state.mode = code;
      state.enabled = true;
    }
    if (code === 5) state.enabled = false;
  }
}

function oracleMove(
  state: OracleState,
  values: Map<string, number>,
): LaserSecondPassSegment | null {
  const feed = values.get('F');
  const power = values.get('S');
  if (feed !== undefined) state.feed = feed * state.unit;
  if (power !== undefined) state.power = power;
  if (!values.has('X') && !values.has('Y')) return null;
  const from = { x: state.x, y: state.y };
  for (const axis of ['X', 'Y'] as const) {
    const raw = values.get(axis);
    if (raw === undefined) continue;
    const key = axis === 'X' ? 'x' : 'y';
    state[key] = raw * state.unit + (state.absolute ? 0 : state[key]);
  }
  return {
    from,
    to: { x: state.x, y: state.y },
    power: state.enabled && !state.rapid ? state.power : 0,
    feed: state.feed,
    mode: state.mode,
    rapid: state.rapid,
  };
}

// Independent intentionally small interpreter: no production scanner, parser,
// clipping, formatter, or manifest is used to check the emitted trajectory.
export function simulateProgram(gcode: string): ReadonlyArray<LaserSecondPassSegment> {
  const state: OracleState = {
    x: 0,
    y: 0,
    unit: 1,
    absolute: true,
    rapid: true,
    enabled: false,
    mode: 4,
    power: 0,
    feed: 0,
  };
  const result: LaserSecondPassSegment[] = [];
  for (const raw of gcode.split(/\r\n|\r|\n/)) {
    const line =
      raw
        .replace(/\([^)]*\)/g, '')
        .split(';')[0]
        ?.replace(/\s/g, '') ?? '';
    const values = new Map<string, number>();
    for (const match of line.matchAll(/([GMXYFS])([+-]?(?:\d+\.?\d*|\.\d+))/g)) {
      const letter = match[1] ?? '';
      const value = Number(match[2]);
      if (letter === 'G' || letter === 'M') oracleModal(state, letter, value);
      else values.set(letter, value);
    }
    const motion = oracleMove(state, values);
    if (motion !== null) result.push(motion);
  }
  return result;
}

function distanceToEdge(
  point: LaserSecondPassPoint,
  a: LaserSecondPassPoint,
  b: LaserSecondPassPoint,
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const squared = vx * vx + vy * vy;
  const ratio = squared === 0 ? 0 : ((point.x - a.x) * vx + (point.y - a.y) * vy) / squared;
  const t = Math.max(0, Math.min(1, ratio));
  return Math.hypot(point.x - a.x - t * vx, point.y - a.y - t * vy);
}

export function maskScaleAt(
  point: LaserSecondPassPoint,
  strokes: ReadonlyArray<LaserSecondPassStroke>,
): number {
  let scale = 0;
  for (const stroke of strokes) {
    const covered = stroke.points.some(
      (a, index) => distanceToEdge(point, a, stroke.points[index + 1] ?? a) <= stroke.radiusMm,
    );
    if (covered) scale = stroke.mode === 'paint' ? stroke.powerScale : 0;
  }
  return scale;
}

export function containsInterior(
  segment: LaserSecondPassSegment,
  point: LaserSecondPassPoint,
): boolean {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  const x = point.x - segment.from.x;
  const y = point.y - segment.from.y;
  const t = (x * dx + y * dy) / (length * length);
  return t > 1e-9 && t < 1 - 1e-9 && Math.abs(x * dy - y * dx) / length < 1e-8;
}
